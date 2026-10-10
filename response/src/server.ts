// Interface HTTP du service de journal. Écoute en local uniquement.
//
//   POST /journal/entries   ajoute une entrée. Corps : type, component,
//                           request_id, agent_id, client_id, data.
//                           En-tête Idempotency-Key facultatif.
//                           201 écrite, 200 déjà écrite, 400 non conforme,
//                           409 clé déjà utilisée pour une autre entrée.
//   GET  /journal/head      { count, seq, hash } : l'empreinte de tête.
//   GET  /journal/entries   ?request_id=0x…&from_seq=n&limit=m
//
// Il n'y a pas d'authentification entre composants : quiconque atteint ce port
// peut ajouter une entrée. D'où l'écoute sur 127.0.0.1 seulement.
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { JournalError } from "./journal.ts";
import type { JournalStore } from "./journal.ts";

const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const BYTES32 = /^0x[0-9a-f]{64}$/;
const UINT = /^(0|[1-9][0-9]{0,15})$/;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      // Au-delà de la limite, on cesse de stocker mais on lit jusqu'au bout
      // pour répondre 413 proprement.
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > MAX_BODY_BYTES ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function postEntry(store: JournalStore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  if (body === null) return send(res, 413, { error: "BODY_TOO_LARGE" });
  let candidate: unknown;
  try {
    candidate = JSON.parse(body);
  } catch {
    return send(res, 400, { error: "INVALID_ENTRY", error_count: 1 });
  }
  const header = req.headers["idempotency-key"];
  const key = Array.isArray(header) ? header[0] : header;
  try {
    const result = store.append(candidate, key);
    return send(res, result.duplicate ? 200 : 201, result);
  } catch (error) {
    if (error instanceof JournalError && error.code === "INVALID_ENTRY") {
      return send(res, 400, { error: error.code, error_count: error.errorCount });
    }
    if (error instanceof JournalError && error.code === "IDEMPOTENCY_CONFLICT") {
      return send(res, 409, { error: error.code });
    }
    throw error;
  }
}

function getEntries(store: JournalStore, url: URL, res: ServerResponse): void {
  const requestId = url.searchParams.get("request_id") ?? undefined;
  const fromSeq = url.searchParams.get("from_seq") ?? "0";
  const limit = url.searchParams.get("limit") ?? String(DEFAULT_LIMIT);
  if ((requestId !== undefined && !BYTES32.test(requestId)) || !UINT.test(fromSeq) || !UINT.test(limit)) {
    return send(res, 400, { error: "INVALID_QUERY" });
  }
  const entries = store.entries({
    ...(requestId === undefined ? {} : { requestId }),
    fromSeq: Number(fromSeq),
    limit: Math.min(Number(limit), MAX_LIMIT),
  });
  send(res, 200, { entries, head: store.head() });
}

export function createJournalServer(store: JournalStore): Server {
  return createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/journal/entries" && req.method === "POST") return postEntry(store, req, res);
      if (url.pathname === "/journal/entries" && req.method === "GET") return getEntries(store, url, res);
      if (url.pathname === "/journal/head" && req.method === "GET") return send(res, 200, store.head());
      if (url.pathname === "/journal/entries" || url.pathname === "/journal/head") {
        return send(res, 405, { error: "METHOD_NOT_ALLOWED" });
      }
      return send(res, 404, { error: "NOT_FOUND" });
    })().catch(() => {
      // Aucune information interne dans la réponse.
      if (!res.headersSent) send(res, 500, { error: "INTERNAL" });
      else res.end();
    });
  });
}
