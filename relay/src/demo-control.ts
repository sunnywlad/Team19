// Port de contrôle de DÉMO : tient la place de l'approbateur devant le faux
// coffre. Séparé de l'API en lecture seule (api.ts), qui reste en lecture
// seule. Il n'existe que si VAULT_MODE=fake ET DEMO_MODE=1 : devant un vrai
// contrat, approuver demande la clé de l'approbateur, pas un appel HTTP.
//
//   POST /demo/approve   { "request_id": "0x…" }
//   POST /demo/refuse    { "request_id": "0x…" }
//   POST /demo/expire    { "request_id": "0x…" }
//
// Chaque route appelle la fonction du faux coffre et rien d'autre. Le coffre
// juge : approuver après l'échéance refuse, expirer avant l'échéance échoue.
// Lié à 127.0.0.1, sans authentification, comme le reste de la démo.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { API_HOST, listen } from "./api.ts";
import { intEnv, readEnv } from "./config.ts";
import type { FakeVault } from "./fake-vault.ts";
import type { Hex } from "./types.ts";

export const DEMO_CONTROL_DEFAULT_PORT = 8788;
const MAX_BODY_BYTES = 1024;
const BYTES32 = /^0x[0-9a-f]{64}$/;
const ACTIONS = { "/demo/approve": "approve", "/demo/refuse": "refuse", "/demo/expire": "expire" } as const;
// Refus du faux coffre que l'appelant peut lire : l'état ne permet pas l'appel.
const VAULT_REFUSALS = new Set(["NoPendingApproval", "DeadlineNotReached", "VaultIsPaused", "AgentIsPaused"]);

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

export function createDemoControl(vault: FakeVault): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    // Nom d'hôte étranger ou appel venu d'une page web : refusé.
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if ((host !== API_HOST && host !== "localhost") || req.headers.origin !== undefined) return send(res, 403, { error: "forbidden" });
    const path = new URL(req.url ?? "/", `http://${API_HOST}`).pathname;
    const action = (ACTIONS as Record<string, "approve" | "refuse" | "expire" | undefined>)[path];
    if (action === undefined) return send(res, 404, { error: "not_found" });
    if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" }, { allow: "POST" });
    void readBody(req).then((raw) => {
      let requestId: unknown;
      try {
        requestId = (JSON.parse(raw ?? "") as { request_id?: unknown } | null)?.request_id;
      } catch {
        requestId = undefined;
      }
      if (typeof requestId !== "string" || !BYTES32.test(requestId)) return send(res, 400, { error: "invalid_body" });
      try {
        vault[action](requestId as Hex);
      } catch (error) {
        const name = error instanceof Error ? error.message : "";
        return VAULT_REFUSALS.has(name) ? send(res, 409, { error: name }) : send(res, 500, { error: "internal" });
      }
      // L'issue ne se lit pas ici : elle est dans l'événement Decision.
      send(res, 200, { called: action, request_id: requestId });
    });
  });
}

/**
 * Démarre le port de contrôle si, et seulement si, le coffre est le faux et
 * que DEMO_MODE vaut 1. Sinon rien n'écoute : null.
 */
export async function startDemoControl(fake: FakeVault | null, env: NodeJS.ProcessEnv = process.env): Promise<{ server: Server; port: number } | null> {
  if (fake === null || readEnv("VAULT_MODE", env) !== "fake" || readEnv("DEMO_MODE", env) !== "1") return null;
  const server = createDemoControl(fake);
  const port = await listen(server, intEnv("DEMO_CONTROL_PORT", DEMO_CONTROL_DEFAULT_PORT, env));
  return { server, port };
}
