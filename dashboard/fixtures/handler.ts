// Routes du serveur de fixtures. Les six premières sont celles de relay/src/api.ts,
// avec les mêmes paramètres et les mêmes formes ; les suivantes sont les points
// d'accès proposés dans API-NEEDS.md. GET uniquement : tout le reste reçoit 405.
import { toDecisions, type World } from "./sim.ts";

const BYTES32 = /^0x[0-9a-f]{64}$/;
const EVENT_NAME = /^[A-Za-z]{1,40}$/;
const MAX_LIMIT = 500;

export type FixtureResponse = { status: number; body: unknown; headers?: Record<string, string> };

class BadRequest extends Error {}

function intParam(url: URL, name: string, fallback: number, max: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  if (!/^\d{1,15}$/.test(raw)) throw new BadRequest(name);
  return Math.min(Number(raw), max);
}

function route(world: World, url: URL): FixtureResponse {
  const path = url.pathname;
  const sinceId = (): number => intParam(url, "since_id", 0, Number.MAX_SAFE_INTEGER);
  const limit = (): number => intParam(url, "limit", 200, MAX_LIMIT);

  // --- Routes du relais (relay/src/api.ts) ---
  if (path === "/health") return { status: 200, body: { ok: true } };
  if (path === "/status") return { status: 200, body: world.status };
  if (path === "/decisions") {
    const requestId = url.searchParams.get("request_id");
    if (requestId !== null && !BYTES32.test(requestId)) throw new BadRequest("request_id");
    const since = sinceId();
    const rows = toDecisions(world.events).filter((d) => d.id > since && (requestId === null || d.request_id === requestId));
    return { status: 200, body: rows.slice(0, limit()) };
  }
  if (path.startsWith("/decisions/")) {
    const requestId = path.slice("/decisions/".length);
    if (!BYTES32.test(requestId)) throw new BadRequest("request_id");
    const current = toDecisions(world.events).filter((d) => d.request_id === requestId).pop();
    return current ? { status: 200, body: current } : { status: 404, body: { error: "not_found" } };
  }
  if (path === "/events") {
    const name = url.searchParams.get("name");
    if (name !== null && !EVENT_NAME.test(name)) throw new BadRequest("name");
    const since = sinceId();
    return { status: 200, body: world.events.filter((e) => e.id > since && (name === null || e.name === name)).slice(0, limit()) };
  }
  if (path === "/queue") return { status: 200, body: [...world.queue].reverse().slice(0, limit()) };

  // --- Points d'accès proposés (API-NEEDS.md) ---
  if (path === "/vault") return { status: 200, body: world.vault };
  if (path === "/incidents") return { status: 200, body: world.incidents };
  if (path === "/journal/entries") return { status: 200, body: world.journal.slice(-limit()) };
  if (path === "/journal/verification") return { status: 200, body: world.verification };
  if (path === "/agents/paused") return { status: 200, body: world.pausedAgents };

  return { status: 404, body: { error: "not_found" } };
}

export function handleFixtureRequest(world: World, method: string, rawUrl: string): FixtureResponse {
  if (method !== "GET" && method !== "HEAD") return { status: 405, body: { error: "method_not_allowed" }, headers: { allow: "GET, HEAD" } };
  try {
    return route(world, new URL(rawUrl, "http://127.0.0.1"));
  } catch (error) {
    if (error instanceof BadRequest) return { status: 400, body: { error: "bad_parameter", parameter: error.message } };
    return { status: 500, body: { error: "internal" } };
  }
}
