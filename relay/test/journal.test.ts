import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SPECS_DIR } from "../src/config.ts";
import { MemoryJournal, entryHash, type NewJournalEntry } from "../src/journal.ts";
import type { Hex } from "../src/types.ts";
import { T0_MS, readSpecJson } from "./helpers.ts";

const RID = `0x${"5".repeat(64)}` as Hex;

test("le bouchon chaîne ses entrées comme specs/04 § 4", async () => {
  const journal = new MemoryJournal(() => T0_MS);
  await journal.append({ type: "ENQUEUED", component: "QUEUE", request_id: RID, agent_id: null, client_id: null, data: { expires_at: 1791662430 } });
  await journal.append({ type: "SUBMITTED", component: "RELAY", request_id: RID, agent_id: null, client_id: null, data: { tx_hash: RID } });
  const [first, second] = journal.entries;
  assert.equal(first!.seq, 0);
  assert.equal(first!.prev_hash, "0".repeat(64));
  assert.equal(second!.prev_hash, first!.hash);
  assert.deepEqual(journal.types(RID), ["ENQUEUED", "SUBMITTED"]);
});

test("la formule du bouchon retrouve l'empreinte de tête de la chaîne d'exemple de specs", () => {
  const manifest = readSpecJson<{ chains: { file: string; head: string }[] }>("examples/journal/manifest.json");
  const chain = manifest.chains.find((c) => c.file === "chaine-valide.jsonl")!;
  const lines = readFileSync(join(SPECS_DIR, "examples/journal", chain.file), "utf8").trim().split("\n");
  let prev = "0".repeat(64);
  for (const line of lines) {
    const { hash, prev_hash, ...body } = JSON.parse(line) as { hash: string; prev_hash: string; seq: number };
    assert.equal(prev_hash, prev);
    assert.equal(entryHash(body, prev), hash, `entrée ${body.seq}`);
    prev = hash;
  }
  assert.equal(prev, chain.head);
});

test("le bouchon refuse une entrée non conforme au schéma gelé", async () => {
  const journal = new MemoryJournal(() => T0_MS);
  const bad = { type: "ENQUEUED", component: "QUEUE", request_id: RID, agent_id: null, client_id: null, data: { expires_at: 1.5 } };
  await assert.rejects(journal.append(bad as NewJournalEntry), TypeError);
  const extra = { type: "SUBMITTED", component: "RELAY", request_id: RID, agent_id: null, client_id: null, data: { tx_hash: RID, note: "x" } };
  await assert.rejects(journal.append(extra as unknown as NewJournalEntry), TypeError);
});
