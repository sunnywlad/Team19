// Aides communes aux tests du cas 1 et de l'API de lecture.
import assert from "node:assert/strict";
import { API_HOST, createApi, listen } from "../src/api.ts";
import type { IndexedDecision } from "../src/indexer.ts";
import type { Hex, SignedRequest } from "../src/types.ts";
import type { Stack } from "./world.ts";

/** Scène 6 : facture au-dessus du seuil, soumise. La demande est en cas 1. */
export async function pendingCase(s: Stack): Promise<{ id: Hex; request: SignedRequest }> {
  const played = await s.play("6");
  assert.equal((await s.relay.tick()).submitted, 1);
  return { id: played.detector.request_id, request: played.signed!.request };
}

export const summary = (d: IndexedDecision | null): [number, string | null] | null => (d ? [d.decision, d.reason_name] : null);

export const CLOSURES: { name: "APPROVED" | "APPROVAL_REFUSED" | "APPROVAL_TIMEOUT"; decision: number; close(s: Stack, id: Hex): void }[] = [
  { name: "APPROVED", decision: 2, close: (s, id) => s.vault.approve(id) },
  { name: "APPROVAL_REFUSED", decision: 0, close: (s, id) => s.vault.refuse(id) },
  {
    name: "APPROVAL_TIMEOUT",
    decision: 0,
    close: (s, id) => {
      s.clock.advanceS(s.f.vault.approval_delay_s + 1);
      s.vault.expire(id);
    },
  },
];

export async function withApi<T>(s: Stack, run: (get: (path: string) => Promise<{ status: number; body: unknown }>) => Promise<T>): Promise<T> {
  const server = createApi({ indexer: s.indexer, queue: s.queue, confirmations: s.policy.confirmations });
  const base = `http://${API_HOST}:${await listen(server, 0)}`;
  try {
    return await run(async (path) => {
      const res = await fetch(`${base}${path}`);
      return { status: res.status, body: await res.json() };
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
