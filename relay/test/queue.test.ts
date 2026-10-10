import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { SignedRequest } from "../src/types.ts";
import { readSpecJson } from "./helpers.ts";
import { makeStack, makeWorld } from "./world.ts";

type Manifest = { cases: { file: string; expect: string; rule?: string; now?: number }[] };

test("la file applique le schéma gelé aux exemples de specs", async () => {
  const manifest = readSpecJson<Manifest>("examples/request/manifest.json");
  for (const c of manifest.cases) {
    const s = makeStack();
    if (c.now !== undefined) s.clock.ms = c.now * 1000;
    const raw = JSON.stringify(readSpecJson<unknown>(`examples/request/${c.file}`));
    const result = await s.queue.enqueue(raw);
    if (c.expect === "valid") assert.equal(result.status, "accepted", c.file);
    else if (c.expect === "schema-invalid") assert.deepEqual(result, { status: "rejected", cause: "SCHEMA_INVALID" }, c.file);
    else assert.deepEqual(result, { status: "rejected", cause: c.rule }, c.file);
    assert.equal(s.queue.pending().length, c.expect === "valid" ? 1 : 0, c.file);
    s.close();
  }
});

test("un rejet par le schéma est journalisé, sans rien croire du contenu", async () => {
  const s = makeStack();
  assert.equal((await s.queue.enqueue("ceci n'est pas du JSON")).status, "rejected");
  assert.equal((await s.queue.enqueue(JSON.stringify({ request_id: "x", amount: "90" }))).status, "rejected");
  assert.deepEqual(s.journal.entries.map((e) => [e.type, e.component, e.request_id, e.agent_id]), [
    ["SCHEMA_REJECTED", "QUEUE", null, null],
    ["SCHEMA_REJECTED", "QUEUE", null, null],
  ]);
  s.close();
});

test("la file ne modifie jamais une demande : le texte ressort octet pour octet", async () => {
  const s = makeStack();
  const request = readSpecJson<SignedRequest>("examples/request/valid/01-paiement-facture.json");
  s.clock.ms = (request.issued_at + 10) * 1000;
  // Ordre des clés et espaces inhabituels : ils doivent survivre tels quels.
  const raw = `{ "signature":"${request.signature}", "expires_at":${request.expires_at},\n"issued_at":${request.issued_at},"ref_id":"${request.ref_id}","action":"${request.action}","agent_id":"${request.agent_id}","client_id":"${request.client_id}","request_id":"${request.request_id}" }`;
  const result = await s.queue.enqueue(raw);
  assert.equal(result.status, "accepted");
  const stored = s.queue.payload((result as { id: number }).id);
  assert.equal(stored?.raw, raw);
  assert.deepEqual(stored?.request, request);
  s.close();
});

test("reprise : la file survit à un redémarrage, et la demande n'est soumise qu'une fois", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-queue-"));
  try {
    const world = makeWorld();
    const paths = { queue: join(dir, "queue.db") };
    const before = makeStack({}, paths, world);
    const played = await before.play("1");
    before.close(); // arrêt avant toute soumission

    const after = makeStack({}, paths, world);
    assert.equal(after.queue.pending().length, 1, "la demande est toujours en attente");
    assert.equal((await after.relay.tick()).submitted, 1);
    after.close();

    const again = makeStack({}, paths, world);
    assert.equal((await again.relay.tick()).submitted, 0);
    assert.deepEqual(await again.queue.enqueue(played.signed!.raw), { status: "duplicate", id: 1 }, "l'idempotence survit au redémarrage");
    assert.equal(world.vault.submissions, 1);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
