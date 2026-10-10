// Service « IA du client » (étapes 5 et 6) : reçoit de la porte d'entrée une
// demande acceptée, la signe avec la clé du client et la dépose dans la file.
// BOUCHON : aucun modèle ne juge la demande, tout ce qui est conforme est signé.
// Lié à 127.0.0.1, sans authentification : quiconque atteint le port obtient
// une demande signée. Seuls des identifiants entrent ; le montant et le
// bénéficiaire ne sont jamais reçus, le contrat les lit dans ses registres.
//   npm run start:client-ia     (variables : voir relay/.env.example)
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { fixtureIds } from "./agents.ts";
import { API_HOST, listen } from "./api.ts";
import { intEnv, readEnv, type ActionName } from "./config.ts";
import { HttpJournal } from "./http-journal.ts";
import { MemoryJournal, type JournalClient } from "./journal.ts";
import { Queue } from "./queue.ts";
import { chainId, clientSignerKey, dbPath, policyFromEnv, stderrAlerts, vaultAddress } from "./runtime.ts";
import { ClientSigner, domainFor, requestDigest } from "./signer.ts";
import { systemClock, type Hex } from "./types.ts";

export const CLIENT_IA_DEFAULT_PORT = 8770;
const MAX_BODY_BYTES = 4096;

/** Ce que la porte d'entrée transmet (gateway/README.md, « Ce que l'IA du client reçoit »). */
export type Accepted = { request_id: Hex; agent_id: Hex; client_id: Hex; action: ActionName; ref_id: Hex };

const BYTES32 = { type: "string", pattern: "^0x[0-9a-f]{64}$", not: { const: `0x${"0".repeat(64)}` } } as const;
const validateAccepted = new Ajv2020({ strict: true, allErrors: true }).compile({
  type: "object",
  additionalProperties: false,
  required: ["request_id", "agent_id", "client_id", "action", "ref_id"],
  properties: { request_id: BYTES32, agent_id: BYTES32, client_id: BYTES32, action: { enum: ["PAY_INVOICE", "PLACE"] }, ref_id: BYTES32 },
});

export type ClientIaDeps = { client: ClientSigner; clientId: Hex; queue: Queue; journal: JournalClient };

export type Reply = { status: 202 | 400 | 502; body: { status: "accepted"; request_id: Hex; duplicate: boolean } | { error: string } };

const invalid = (error: string): Reply => ({ status: 400, body: { error } });
const UNAVAILABLE: Reply = { status: 502, body: { error: "queue_unavailable" } };

/**
 * Traite le corps d'un POST /accepted. Une demande déjà en file sous ce
 * request_id n'est ni signée ni déposée une seconde fois.
 */
export async function handleAccepted(raw: string, deps: ClientIaDeps): Promise<Reply> {
  const { client, queue, journal } = deps;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalid("invalid_body");
  }
  if (!validateAccepted(parsed)) return invalid("invalid_body");
  const accepted = parsed as Accepted;
  // Ce service ne tient la clé que d'un client : il ne signe pour aucun autre.
  if (accepted.client_id !== deps.clientId) return invalid("unknown_client");

  try {
    const known = queue.byRequestId(accepted.request_id)[0];
    if (known) {
      const stored = queue.payload(known.id)?.request;
      if (!stored) return UNAVAILABLE;
      const same = stored.agent_id === accepted.agent_id && stored.client_id === accepted.client_id && stored.action === accepted.action && stored.ref_id === accepted.ref_id;
      return same ? { status: 202, body: { status: "accepted", request_id: accepted.request_id, duplicate: true } } : invalid("request_id_conflict");
    }

    const request = await client.emit({ request_id: accepted.request_id, agent_id: accepted.agent_id, action: accepted.action, ref_id: accepted.ref_id });
    await journal.append({
      type: "REQUEST_SIGNED",
      component: "CLIENT_AI",
      request_id: request.request_id,
      agent_id: request.agent_id,
      client_id: request.client_id,
      data: {
        action: request.action,
        ref_id: request.ref_id,
        issued_at: request.issued_at,
        expires_at: request.expires_at,
        signer: client.address,
        request_digest: requestDigest(request, client.domain),
      },
    });
    const result = await queue.enqueue(JSON.stringify(request));
    if (result.status === "accepted" || result.status === "duplicate") {
      return { status: 202, body: { status: "accepted", request_id: request.request_id, duplicate: result.status === "duplicate" } };
    }
    // Entrée par un autre processus entre-temps, avec un autre contenu.
    if (result.status === "conflict") return invalid("request_id_conflict");
    // La file a écarté une demande que ce service vient de construire : défaut interne.
    return UNAVAILABLE;
  } catch {
    // Journal ou base de la file injoignable : rien n'est pris en compte.
    return UNAVAILABLE;
  }
}

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > MAX_BODY_BYTES ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

export function createClientIa(deps: ClientIaDeps): Server {
  // Une demande à la fois : deux remises simultanées du même request_id ne
  // produisent pas deux signatures.
  let turn: Promise<unknown> = Promise.resolve();
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    // Nom d'hôte étranger ou appel venu d'une page web : refusé. Une page ne
    // doit pas pouvoir faire signer une demande par un navigateur local.
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if ((host !== API_HOST && host !== "localhost") || req.headers.origin !== undefined) return send(res, 403, { error: "forbidden" });
    const path = new URL(req.url ?? "/", `http://${API_HOST}`).pathname;
    if (path === "/health" && req.method === "GET") return send(res, 200, { ok: true });
    if (path !== "/accepted") return send(res, 404, { error: "not_found" });
    if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" }, { allow: "POST" });
    if (!/^application\/json\s*(;|$)/i.test(req.headers["content-type"] ?? "")) return send(res, 400, { error: "invalid_body" });
    const reply = readBody(req).then((raw): Reply | Promise<Reply> => {
      if (raw === null) return invalid("invalid_body");
      const mine = turn.then(() => handleAccepted(raw, deps));
      turn = mine.catch(() => undefined);
      return mine;
    });
    reply.then(
      ({ status, body }) => send(res, status, body),
      () => send(res, 502, UNAVAILABLE.body),
    );
  });
}

// --- Lancement ----------------------------------------------------------------

async function main(): Promise<void> {
  const policy = policyFromEnv();
  const clientId = (readEnv("CLIENT_ID") as Hex | undefined) ?? fixtureIds()["C-DEMO"]!;
  const client = new ClientSigner(clientSignerKey(), clientId, domainFor(chainId(), vaultAddress()), policy, systemClock);
  // Même règle que le relais : avec JOURNAL_URL, le journal est obligatoire.
  const journalUrl = readEnv("JOURNAL_URL");
  const journal: JournalClient = journalUrl === undefined ? new MemoryJournal(systemClock) : new HttpJournal(journalUrl);
  const queue = new Queue({ path: dbPath("QUEUE_DB", "var/queue.db"), policy, clock: systemClock, journal, alerts: stderrAlerts });
  const port = await listen(createClientIa({ client, clientId, queue, journal }), intEnv("CLIENT_IA_PORT", CLIENT_IA_DEFAULT_PORT));
  console.error(journalUrl === undefined ? "[client-ia] journal : bouchon en mémoire (JOURNAL_URL absente)" : "[client-ia] journal : service de journal (JOURNAL_URL)");
  console.error(`[client-ia] BOUCHON sans modèle : POST http://${API_HOST}:${port}/accepted`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
