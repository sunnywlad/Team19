import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { makeStack, makeWorld } from "./world.ts";

test("point b : le relais refuse la demande d'un agent en pause hors chaîne", async () => {
  const s = makeStack();
  const played = await s.play("1");
  s.offchainPauses.paused.add(s.ids["A-DEM-1"]!);
  assert.deepEqual(await s.relay.tick(), { submitted: 0, rejected: 1, deferred: 0, inDoubt: 0, expired: 0 });
  const row = s.queue.byRequestId(played.detector.request_id)[0]!;
  assert.deepEqual([row.status, row.cause], ["REJECTED", "AGENT_PAUSED"]);
  assert.equal(s.vault.submissions, 0);
  s.close();
});

test("point b : le relais refuse aussi un agent en pause sur la chaîne", async () => {
  const s = makeStack();
  await s.play("1");
  s.vault.pauseAgent(s.ids["A-DEM-1"]!);
  assert.equal((await s.relay.tick()).rejected, 1);
  assert.equal(s.vault.submissions, 0);
  s.close();
});

test("point b désactivé : le relais soumet et le coffre refuse (AGENT_PAUSED)", async () => {
  const s = makeStack({ relayRefusesPausedAgents: false });
  const played = await s.play("1");
  s.vault.pauseAgent(s.ids["A-DEM-1"]!);
  assert.equal((await s.relay.tick()).submitted, 1);
  await s.index();
  assert.equal(s.indexer.currentDecision(played.detector.request_id)?.reason_name, "AGENT_PAUSED");
  assert.equal(s.vault.cash, 100n * s.unit);
  s.close();
});

test("réponse perdue : la demande passe « dans le doute » et n'est jamais renvoyée", async () => {
  const s = makeStack();
  const played = await s.play("1");
  const id = played.detector.request_id;
  s.vault.fault = "lost_reply";
  assert.equal((await s.relay.tick()).inDoubt, 1);
  s.vault.fault = "none";
  for (let i = 0; i < 3; i += 1) assert.equal((await s.relay.tick()).submitted, 0);

  assert.equal(s.vault.submissions, 1, "une seule soumission malgré l'incertitude");
  assert.equal(s.queue.byRequestId(id)[0]!.status, "IN_DOUBT");
  assert.deepEqual(s.alerts.sent.map((a) => a.kind), ["SUBMISSION_IN_DOUBT"]);
  // L'index, lui, dit ce qui s'est passé : la décision se lit dans l'événement.
  await s.index();
  assert.equal(s.indexer.currentDecision(id)?.decision, 2);
  s.close();
});

test("reprise : un arrêt pendant la soumission ne provoque aucun renvoi", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-crash-"));
  try {
    const world = makeWorld();
    const paths = { queue: join(dir, "queue.db") };
    const before = makeStack({}, paths, world);
    const played = await before.play("1");
    // Le processus s'arrête juste après avoir noté son intention d'envoyer.
    before.queue.markSubmitting(before.queue.pending()[0]!.id);
    before.close();

    const after = makeStack({}, paths, world);
    assert.equal(after.queue.byRequestId(played.detector.request_id)[0]!.status, "IN_DOUBT");
    assert.equal((await after.relay.tick()).submitted, 0);
    assert.equal(world.vault.submissions, 0);
    after.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("coffre injoignable puis de retour : la demande part une fois, tant qu'elle est valable", async () => {
  const s = makeStack();
  const played = await s.play("1");
  s.vault.fault = "down";
  assert.equal((await s.relay.tick()).deferred, 1);
  s.clock.advanceS(5);
  s.vault.fault = "none";
  assert.equal((await s.relay.tick()).submitted, 1);
  assert.equal((await s.relay.tick()).submitted, 0);
  assert.equal(s.vault.submissions, 1);
  assert.equal(s.queue.byRequestId(played.detector.request_id)[0]!.status, "SUBMITTED");
  s.close();
});
