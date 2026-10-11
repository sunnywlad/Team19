import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { GENESIS_HASH } from "../src/chain.ts";
import type { Head } from "../src/chain.ts";
import { ResponseEngine } from "../src/engine.ts";
import type { IndexedDecision } from "../src/engine.ts";
import { JournalStore } from "../src/journal.ts";
import { archiveStamp, createJournalServer } from "../src/server.ts";
import { verifyJournalText } from "../src/verify.ts";

const ID = (n: number): string => `0x${n.toString(16).padStart(64, "0")}`;
const AGENT = ID(0xa1);
const CLIENT = ID(0xc1);

let dir: string;
let now: number;
let store: JournalStore;
let engine: ResponseEngine;

function blocked(requestId: string): void {
  const received = (now += 5);
  const ids = { component: "GATEWAY", request_id: requestId, agent_id: AGENT, client_id: CLIENT };
  store.append({ type: "REQUEST_RECEIVED", ...ids, data: { received_at_ms: received, document_sha256: "ab".repeat(32) } });
  store.append({
    type: "DETECTION",
    ...ids,
    data: { score: 93, threshold: 70, verdict: "BLOCK", reason_codes: ["INSTRUCTION_IN_DATA"], received_at_ms: received, detected_at_ms: (now += 5), detector_version: "regles-0.2" },
  });
}

function decision(requestId: string, reason: number, logIndex: number, code: number): IndexedDecision {
  return {
    request_id: requestId,
    agent_id: AGENT,
    client_id: CLIENT,
    action: 1,
    decision: code,
    reason,
    ref_id: ID(0xf1),
    tx_hash: ID(0x7000 + logIndex),
    log_index: logIndex,
    block_number: 10 + logIndex,
    block_timestamp: Math.floor(now / 1000) + logIndex,
  };
}

async function withServer(demoMode: boolean, run: (url: string) => Promise<void>): Promise<void> {
  const server = createJournalServer(store, engine, () => now, { demoMode });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "demo-"));
  now = 1_800_000_000_000;
  store = JournalStore.open(join(dir, "journal.jsonl"), () => (now += 5));
  engine = new ResponseEngine({ store, clock: () => (now += 5), reportsDir: join(dir, "incidents") });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("état du service", () => {
  it("GET /health répond, avec ou sans mode démo", async () => {
    blocked(ID(1));
    await withServer(false, async (url) => {
      assert.deepEqual(await (await fetch(`${url}/health`)).json(), { ok: true, entries: store.head().count, demo_mode: false });
    });
  });
});

describe("remise à zéro de démo", () => {
  it("n'existe pas sans DEMO_MODE : rien ne peut vider le journal", async () => {
    blocked(ID(1));
    const before = store.head();
    await withServer(false, async (url) => {
      assert.equal((await fetch(`${url}/demo/reset`, { method: "POST" })).status, 404);
    });
    assert.deepEqual(store.head(), before);
    assert.equal(engine.incidents().length, 1);
  });

  it("archive le journal et les rapports, puis repart d'une chaîne neuve", async () => {
    blocked(ID(1));
    const before: Head = store.head();
    const text = readFileSync(store.path, "utf8");
    assert.equal(engine.isPaused(AGENT), true);

    await withServer(true, async (url) => {
      assert.equal((await fetch(`${url}/demo/reset`)).status, 405);
      const response = await fetch(`${url}/demo/reset`, { method: "POST" });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { archived_journal: string; archived_head: Head; archived_reports: string };

      // Rien n'est effacé : le journal archivé est intact et sa tête est gardée à côté.
      assert.deepEqual(body.archived_head, before);
      assert.equal(readFileSync(body.archived_journal, "utf8"), text);
      const savedHead = JSON.parse(readFileSync(`${body.archived_journal}.head.json`, "utf8")) as Head;
      assert.equal(verifyJournalText(text, { expectHead: savedHead.hash }).code, 0);
      assert.equal(readdirSync(body.archived_reports).length, 1);
      assert.match(body.archived_journal, /journal\.jsonl\.\d{8}T\d{6}Z\.bak$/);

      // Chaîne neuve, état remis à zéro.
      assert.deepEqual(await (await fetch(`${url}/journal/head`)).json(), { count: 0, seq: null, hash: GENESIS_HASH });
      assert.deepEqual(await (await fetch(`${url}/agents/paused`)).json(), []);
      assert.deepEqual(await (await fetch(`${url}/incidents`)).json(), []);
    });

    // Le service continue : la chaîne suivante repart du rang 0 et reste valide.
    blocked(ID(2));
    assert.equal(store.entries()[0]?.seq, 0);
    assert.equal(store.entries()[0]?.prev_hash, GENESIS_HASH);
    assert.equal(engine.incidents().length, 1);
    assert.equal(verifyJournalText(readFileSync(store.path, "utf8"), { expectHead: store.head().hash }).code, 0);
    assert.equal(existsSync(join(dir, "incidents")), true);
  });

  it("oublie les clés d'idempotence de l'ancienne chaîne", () => {
    const entry = { type: "ENQUEUED", component: "QUEUE", request_id: ID(1), agent_id: AGENT, client_id: CLIENT, data: { expires_at: 1_800_000_300 } };
    assert.equal(store.append(entry, "cle").duplicate, false);
    store.archive(archiveStamp(now));
    assert.equal(store.append(entry, "cle").duplicate, false);
    assert.equal(store.head().count, 1);
  });

  it("nomme l'archive à la seconde, en UTC", () => {
    assert.equal(archiveStamp(Date.UTC(2026, 9, 10, 21, 15, 0)), "20261010T211500Z");
  });
});

describe("décision courante d'une demande", () => {
  it("un refus de rejeu ne masque pas la décision qui l'a précédé", () => {
    // Cas 1 en attente, puis la même demande est rejouée et refusée (motif 3).
    engine.observeDecision(decision(ID(1), 10, 0, 1));
    engine.observeDecision(decision(ID(1), 3, 1, 0));
    engine.observeDecision(decision(ID(2), 3, 2, 0));
    // Troisième refus bénin : incident de répétition, déclenché par la demande 3.
    engine.observeDecision(decision(ID(3), 3, 3, 0));
    const report = engine.incidents().at(-1)?.report;
    assert.equal(report?.trigger, "REPEATED_REFUSALS");
    // La demande déclenchante n'a qu'un refus de rejeu : c'est bien lui qui figure.
    assert.equal(report?.contract?.reason, 3);
  });

  it("garde le cas 1 comme décision d'une demande rejouée ensuite", () => {
    engine.observeDecision(decision(ID(1), 1, 0, 0)); // incident sur la demande 1
    engine.observeDecision(decision(ID(1), 3, 1, 0)); // puis elle est rejouée
    store.append({
      type: "HUMAN_DECISION",
      component: "HUMAN",
      request_id: null,
      agent_id: AGENT,
      client_id: CLIENT,
      data: { incident_id: engine.incidents()[0]?.report.incident_id, decision: "ATTACK_CONFIRMED", author_role: "ANALYST", author_id: ID(0xb1) },
    });
    // Le rapport régénéré garde le motif d'origine, pas le refus de rejeu.
    assert.equal(engine.incidents().at(-1)?.report.contract?.reason, 1);
  });
});
