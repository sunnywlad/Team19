// Client HTTP du journal : une entrée remise au service de response/, et un
// échec fermé dès que le service ne l'a pas prise.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { HttpJournal, JournalError, idempotencyKey } from "../src/http-journal.ts";
import type { NewJournalEntry } from "../src/journal.ts";
import type { Hex } from "../src/types.ts";
import { makeStack } from "./world.ts";

type Seen = { method: string; url: string; key: string | undefined; body: unknown };

async function journalService(status: () => number): Promise<{ url: string; seen: Seen[]; server: Server }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const key = req.headers["idempotency-key"];
      seen.push({ method: req.method ?? "", url: req.url ?? "", key: typeof key === "string" ? key : undefined, body: JSON.parse(raw) as unknown });
      res.writeHead(status(), { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`, seen, server };
}

const ID = `0x${"ab".repeat(32)}` as Hex;
const submitted = (tx: string): NewJournalEntry => ({
  type: "SUBMITTED", component: "RELAY", request_id: ID, agent_id: ID, client_id: ID, data: { tx_hash: `0x${tx.repeat(32)}` as Hex },
});

test("journal HTTP : POST /journal/entries, corps sans champ attribué par le service, clé d'idempotence", async () => {
  const service = await journalService(() => 201);
  try {
    const entry = submitted("11");
    await new HttpJournal(`${service.url}/`).append(entry);
    assert.equal(service.seen.length, 1);
    const [call] = service.seen;
    assert.deepEqual([call!.method, call!.url], ["POST", "/journal/entries"]);
    assert.deepEqual(call!.body, entry);
    assert.equal(call!.key, idempotencyKey(entry));
  } finally {
    service.server.close();
  }
});

test("clé d'idempotence : stable pour la même entrée, distincte pour une autre soumission", () => {
  assert.equal(idempotencyKey(submitted("11")), idempotencyKey(submitted("11")));
  assert.notEqual(idempotencyKey(submitted("11")), idempotencyKey(submitted("22")));
  assert.match(idempotencyKey(submitted("11")), /^SUBMITTED:0x(ab){32}:[0-9a-f]{24}$/);
  assert.ok(idempotencyKey(submitted("11")).length <= 200);
  const anonymous: NewJournalEntry = { type: "SCHEMA_REJECTED", component: "QUEUE", request_id: null, agent_id: null, client_id: null, data: { error_count: 2 } };
  assert.match(idempotencyKey(anonymous), /^SCHEMA_REJECTED:-:/);
});

test("journal HTTP : 200 (déjà écrite) passe ; refus, erreur ou silence lèvent JournalError", async () => {
  let status = 200;
  const service = await journalService(() => status);
  try {
    const journal = new HttpJournal(service.url);
    await journal.append(submitted("11"));
    for (status of [400, 409, 413, 500, 503]) {
      await assert.rejects(journal.append(submitted("11")), (error: unknown) => error instanceof JournalError && error.message.includes(String(status)));
    }
  } finally {
    service.server.close();
  }
  // Service arrêté : injoignable, et le message ne porte pas l'URL.
  await assert.rejects(new HttpJournal(service.url).append(submitted("11")), (error: unknown) => {
    return error instanceof JournalError && error.message === "service de journal injoignable";
  });
  assert.throws(() => new HttpJournal("file:///etc/passwd"));
});

test("journal coupé : rien n'entre en file (pas d'entrée de journal, pas d'entrée en file)", async () => {
  const service = await journalService(() => 503);
  const s = makeStack();
  try {
    const journal = new HttpJournal(service.url);
    const signed = await s.client.emit({ request_id: ID, agent_id: s.ids["A-DEM-1"]!, action: "PAY_INVOICE", ref_id: s.ids["F-001"]! });
    const { Queue } = await import("../src/queue.ts");
    const { MemoryAlerts } = await import("../src/alerts.ts");
    const queue = new Queue({ path: ":memory:", policy: s.policy, clock: s.clock.now, journal, alerts: new MemoryAlerts() });
    await assert.rejects(queue.enqueue(JSON.stringify(signed)), JournalError);
    assert.equal(queue.list().length, 0);
    queue.close();
  } finally {
    service.server.close();
    s.close();
  }
});
