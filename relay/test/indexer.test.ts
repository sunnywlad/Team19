import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { API_HOST, createApi, listen } from "../src/api.ts";
import { Indexer } from "../src/indexer.ts";
import type { Hex } from "../src/types.ts";
import type { VaultClient, VaultEvent } from "../src/vault.ts";
import { makeStack, makeWorld } from "./world.ts";

test("l'indexeur attend le nombre de confirmations fixé", async () => {
  const s = makeStack({ confirmations: 3 });
  await s.play("1");
  await s.relay.tick();
  assert.equal((await s.indexer.tick()).inserted, 0, "bloc de la décision non confirmé");
  s.vault.mine(2);
  assert.equal((await s.indexer.tick()).inserted, 0, "deux confirmations sur trois");
  s.vault.mine(1);
  assert.equal((await s.indexer.tick()).inserted, 2, "Decision et Paid");
  s.close();
});

test("idempotence : relire les mêmes blocs n'écrit rien de plus", async () => {
  const w = makeWorld();
  const s = makeStack({}, {}, w);
  await s.play("1");
  await s.relay.tick();
  await s.play("4");
  await s.relay.tick();
  await s.index();
  const count = s.indexer.count();
  assert.equal(count, 3, "Decision et Paid, puis Decision");

  // Un RPC qui rend deux fois chaque événement, et les rend encore au tour
  // suivant : la clé unique (tx_hash, log_index) ne laisse entrer qu'une copie.
  let head = await w.vault.blockNumber();
  const all = await w.vault.events(0n, head);
  const replay: VaultClient = { ...stub(), blockNumber: async () => head, events: async () => [...all, ...all] };
  const dir = mkdtempSync(join(tmpdir(), "relay-index-"));
  try {
    const path = join(dir, "index.db");
    const first = new Indexer({ path, vault: replay, startBlock: 0n, confirmations: 0 });
    assert.equal((await first.tick()).inserted, count);
    first.close();

    head += 5n;
    const second = new Indexer({ path, vault: replay, startBlock: 0n, confirmations: 0 });
    assert.equal(second.nextBlock(), head - 4n, "le point de reprise est conservé, startBlock ne le remet pas à zéro");
    assert.equal((await second.tick()).inserted, 0, "événements déjà connus : rien n'est réécrit");
    assert.equal(second.count(), count);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  s.close();
});

test("reprise : l'indexeur repart du bloc stocké, sans trou ni doublon", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-index-"));
  try {
    const world = makeWorld();
    const paths = { index: join(dir, "index.db") };
    const before = makeStack({}, paths, world);
    const first = await before.play("1");
    await before.relay.tick();
    await before.index();
    const next = before.indexer.nextBlock();
    const second = await before.play("4");
    await before.relay.tick(); // décision émise, indexeur arrêté avant de la lire
    before.close();

    const after = makeStack({}, paths, world);
    assert.equal(after.indexer.nextBlock(), next);
    assert.equal(after.indexer.count(), 2);
    await after.index();
    assert.equal(after.indexer.count(), 3);
    assert.equal(after.indexer.currentDecision(first.detector.request_id)?.decision, 2);
    assert.equal(after.indexer.currentDecision(second.detector.request_id)?.reason_name, "INVOICE_UNKNOWN");
    assert.equal((await after.indexer.tick()).inserted, 0);
    after.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("un échec de lecture n'avance pas le point de reprise", async () => {
  let fail = true;
  const vault: VaultClient = {
    ...stub(),
    blockNumber: async () => 10n,
    events: async () => {
      if (fail) throw new Error("RPC injoignable (simulé)");
      return [];
    },
  };
  const indexer = new Indexer({ path: ":memory:", vault, startBlock: 4n, confirmations: 2 });
  await assert.rejects(indexer.tick());
  assert.equal(indexer.nextBlock(), 4n);
  fail = false;
  assert.equal((await indexer.tick()).nextBlock, 9n, "jusqu'au bloc 8 = 10 − 2 confirmations");
  indexer.close();
});

test("un motif inconnu est gardé tel quel et traité comme un refus", async () => {
  const id = `0x${"3".repeat(64)}` as Hex;
  const event: VaultEvent = {
    name: "Decision",
    txHash: `0x${"9".repeat(64)}`,
    logIndex: 0,
    blockNumber: 1n,
    blockTimestamp: 1791662400,
    args: { requestId: id, agentId: id, clientId: id, action: 1, decision: 2, reason: 200, refId: id },
  };
  const indexer = new Indexer({ path: ":memory:", vault: { ...stub(), blockNumber: async () => 1n, events: async () => [event] }, startBlock: 0n, confirmations: 0 });
  await indexer.tick();
  const d = indexer.currentDecision(id)!;
  assert.deepEqual([d.decision, d.reason, d.reason_name, d.effective_decision], [2, 200, null, 0]);
  assert.deepEqual([d.block_number, d.block_timestamp, d.log_index], [1, 1791662400, 0]);
  indexer.close();
});

test("API : lecture seule, liée à 127.0.0.1", async () => {
  const s = makeStack();
  const played = await s.play("1");
  await s.relay.tick();
  await s.index();
  const id = played.detector.request_id;

  const server = createApi({ indexer: s.indexer, queue: s.queue, confirmations: s.policy.confirmations });
  const port = await listen(server, 0);
  const base = `http://${API_HOST}:${port}`;
  try {
    const address = server.address();
    assert.equal(typeof address === "object" && address ? address.address : "", "127.0.0.1");

    const current = (await (await fetch(`${base}/decisions/${id}`)).json()) as { decision: number; reason_name: string; block_number: number; block_timestamp: number };
    assert.deepEqual([current.decision, current.reason_name], [2, "NONE"]);
    assert.ok(current.block_number > 0 && current.block_timestamp > 0);

    const list = (await (await fetch(`${base}/decisions?request_id=${id}`)).json()) as unknown[];
    assert.equal(list.length, 1);
    const paid = (await (await fetch(`${base}/events?name=Paid`)).json()) as unknown[];
    assert.equal(paid.length, 1);
    const queue = (await (await fetch(`${base}/queue`)).json()) as Record<string, unknown>[];
    assert.equal(queue[0]!.status, "SUBMITTED");
    assert.equal("payload" in queue[0]!, false, "ni contenu ni signature dans la vue de la file");
    const status = (await (await fetch(`${base}/status`)).json()) as { events: number };
    assert.equal(status.events, 2);

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await fetch(`${base}/decisions`, { method });
      assert.equal(res.status, 405, method);
    }
    assert.equal((await fetch(`${base}/decisions/pas-un-identifiant`)).status, 400);
    assert.equal((await fetch(`${base}/decisions/0x${"0".repeat(63)}1`)).status, 404);
    assert.equal((await fetch(`${base}/events?limit=abc`)).status, 400);
    assert.equal((await fetch(`${base}/inconnu`)).status, 404);
    assert.equal(s.indexer.count(), 2, "aucune requête n'a écrit");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    s.close();
  }
});

function stub(): VaultClient {
  return {
    submit: async () => ({ kind: "not_sent", cause: "bouchon" }),
    agentPaused: async () => false,
    blockNumber: async () => 0n,
    events: async () => [],
  };
}
