// API HTTP en lecture seule pour le dashboard et le service de réponse.
// Liée à 127.0.0.1, GET uniquement : aucune route ne modifie quoi que ce soit.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Indexer } from "./indexer.ts";
import type { Queue } from "./queue.ts";
import type { Hex } from "./types.ts";

export const API_HOST = "127.0.0.1";
const BYTES32 = /^0x[0-9a-f]{64}$/;
const EVENT_NAME = /^[A-Za-z]{1,40}$/;
const MAX_LIMIT = 500;

export type ApiDeps = { indexer: Indexer; queue?: Queue; confirmations: number };

class BadRequest extends Error {}

function intParam(url: URL, name: string, fallback: number, max: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  if (!/^\d{1,15}$/.test(raw)) throw new BadRequest(name);
  return Math.min(Number(raw), max);
}

function route(url: URL, deps: ApiDeps): { status: number; body: unknown } {
  const { indexer, queue } = deps;
  const path = url.pathname;

  if (path === "/health") return { status: 200, body: { ok: true } };
  if (path === "/status") {
    return { status: 200, body: { next_block: indexer.nextBlock().toString(), confirmations: deps.confirmations, events: indexer.count() } };
  }
  if (path === "/decisions") {
    const requestId = url.searchParams.get("request_id");
    if (requestId !== null && !BYTES32.test(requestId)) throw new BadRequest("request_id");
    return {
      status: 200,
      body: indexer.decisions({
        ...(requestId === null ? {} : { requestId: requestId as Hex }),
        sinceId: intParam(url, "since_id", 0, Number.MAX_SAFE_INTEGER),
        limit: intParam(url, "limit", 200, MAX_LIMIT),
      }),
    };
  }
  if (path.startsWith("/decisions/")) {
    const requestId = path.slice("/decisions/".length);
    if (!BYTES32.test(requestId)) throw new BadRequest("request_id");
    const current = indexer.currentDecision(requestId as Hex);
    return current ? { status: 200, body: current } : { status: 404, body: { error: "not_found" } };
  }
  if (path === "/events") {
    const name = url.searchParams.get("name");
    if (name !== null && !EVENT_NAME.test(name)) throw new BadRequest("name");
    return {
      status: 200,
      body: indexer.events({
        ...(name === null ? {} : { name }),
        sinceId: intParam(url, "since_id", 0, Number.MAX_SAFE_INTEGER),
        limit: intParam(url, "limit", 200, MAX_LIMIT),
      }),
    };
  }
  if (path === "/queue" && queue) {
    return { status: 200, body: queue.list(intParam(url, "limit", 200, MAX_LIMIT)) };
  }
  return { status: 404, body: { error: "not_found" } };
}

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extra,
  });
  res.end(JSON.stringify(body));
}

export function createApi(deps: ApiDeps): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, { error: "method_not_allowed" }, { allow: "GET, HEAD" });
    }
    // Refuse un nom d'hôte étranger : une page web ne peut pas faire passer
    // 127.0.0.1 pour son propre domaine (rebinding DNS).
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (host !== API_HOST && host !== "localhost") return send(res, 403, { error: "forbidden_host" });
    try {
      const { status, body } = route(new URL(req.url ?? "/", `http://${API_HOST}`), deps);
      send(res, status, body);
    } catch (error) {
      if (error instanceof BadRequest) return send(res, 400, { error: "bad_parameter", parameter: error.message });
      send(res, 500, { error: "internal" });
    }
  });
}

/** Écoute sur 127.0.0.1 uniquement. port 0 : un port libre est choisi. */
export function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, API_HOST, () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : port);
    });
  });
}
