// Client HTTP du journal : une entrée remise au service de response/, et un
// échec fermé dès que le service ne l'a pas prise. La clé d'idempotence est
// attribuée une fois par entrée, gardée avec elle, et ne dépend pas du contenu.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpJournal, JournalError } from "../src/http-journal.ts";
import type { NewJournalEntry } from "../src/journal.ts";
import type { Hex } from "../src/types.ts";
import { makeStack } from "./world.ts";

type Seen = { method: string; url: string; key: string | undefined; body: unknown; raw: string };

async function journalService(status: () => number): Promise<{ url: string; seen: Seen[]; server: Server }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const key = req.headers["idempotency-key"];
      seen.push({ method: req.method ?? "", url: req.url ?? "", key: typeof key === "string" ? key : undefined, body: JSON.parse(raw) as unknown, raw });
      const code = status();
      if (code === 0) return; // silence : le client abandonne à son délai
      res.writeHead(code, { "content-type": "application/json" });
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const rejected = (): NewJournalEntry => ({ type: "SCHEMA_REJECTED", component: "QUEUE", request_id: null, agent_id: null, client_id: null, data: { error_count: 2 } });
const stop = (service: { server: Server }): void => {
  service.server.closeAllConnections();
  service.server.close();
};

test("journal HTTP : POST /journal/entries, corps sans champ attribué par le service, clé d'idempotence opaque", async () => {
  const service = await journalService(() => 201);
  try {
    const entry = submitted("11");
    const journal = new HttpJournal(`${service.url}/`);
    await journal.append(entry);
    assert.equal(service.seen.length, 1);
    const [call] = service.seen;
    assert.deepEqual([call!.method, call!.url], ["POST", "/journal/entries"]);
    assert.deepEqual(call!.body, entry);
    assert.match(call!.key ?? "", UUID, "ni type, ni identifiant, ni empreinte du contenu dans la clé");
    assert.ok((call!.key ?? "").length <= 200);
    assert.equal(journal.pending().length, 0, "remise : la boîte d'envoi est vide");
  } finally {
    stop(service);
  }
});

test("retry : une tentative restée sans réponse, puis la reprise, portent la même clé et le même corps", async () => {
  let status = 0; // le service reçoit la première remise et ne répond jamais
  const service = await journalService(() => status);
  const journal = new HttpJournal(service.url, { timeoutMs: 150 });
  try {
    await assert.rejects(journal.append(submitted("11")), (error: unknown) => error instanceof JournalError && error.message === "service de journal injoignable");
    const [waiting] = journal.pending();
    assert.equal(waiting!.idempotency_key, service.seen[0]!.key, "la clé est gardée avec l'entrée");

    status = 503; // deuxième tentative : le service répond, mais en erreur
    await assert.rejects(journal.flush(), JournalError);
    status = 201;
    await journal.flush();

    assert.equal(service.seen.length, 3);
    assert.deepEqual(service.seen.map((call) => call.key), Array(3).fill(service.seen[0]!.key), "même clé à chaque tentative");
    assert.deepEqual(service.seen.map((call) => call.raw), Array(3).fill(service.seen[0]!.raw), "même corps, à l'octet près");
    assert.equal(journal.pending().length, 0);
    await journal.flush();
    assert.equal(service.seen.length, 3, "une entrée remise n'est plus renvoyée");
  } finally {
    stop(service);
  }
});

test("deux rejets identiques : deux clés, deux entrées", async () => {
  const service = await journalService(() => 201);
  try {
    const journal = new HttpJournal(service.url);
    // Deux SCHEMA_REJECTED sans request_id et de même error_count : deux faits.
    await journal.append(rejected());
    await journal.append(rejected());
    assert.equal(service.seen.length, 2);
    assert.equal(service.seen[0]!.raw, service.seen[1]!.raw, "corps identiques");
    assert.notEqual(service.seen[0]!.key, service.seen[1]!.key);
    assert.match(service.seen[1]!.key ?? "", UUID);
  } finally {
    stop(service);
  }
});

test("deux rejets identiques pendant une panne : toujours deux clés, remis dans l'ordre à la reprise", async () => {
  let status = 503;
  const service = await journalService(() => status);
  try {
    const journal = new HttpJournal(service.url);
    await assert.rejects(journal.append(rejected()), JournalError);
    await assert.rejects(journal.append(rejected()), JournalError);
    const waiting = journal.pending().map((row) => row.idempotency_key);
    assert.equal(new Set(waiting).size, 2);
    status = 201;
    service.seen.length = 0;
    await journal.append(submitted("11"));
    assert.deepEqual(service.seen.map((call) => call.key).slice(0, 2), waiting, "les entrées en attente partent d'abord, sous leur clé");
    assert.deepEqual(service.seen.map((call) => (call.body as { type: string }).type), ["SCHEMA_REJECTED", "SCHEMA_REJECTED", "SUBMITTED"]);
  } finally {
    stop(service);
  }
});

test("reprise après redémarrage : l'entrée en attente repart sous sa clé d'origine", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-outbox-"));
  let status = 0;
  const service = await journalService(() => status);
  try {
    const outboxPath = join(dir, "journal-outbox.db");
    const before = new HttpJournal(service.url, { outboxPath, timeoutMs: 150 });
    await assert.rejects(before.append(submitted("11")), JournalError);
    const original = service.seen[0]!;
    before.close(); // le processus s'arrête sans avoir eu de réponse

    status = 201;
    const after = new HttpJournal(service.url, { outboxPath });
    assert.deepEqual(after.pending().map((row) => row.idempotency_key), [original.key]);
    await after.flush();
    assert.equal(service.seen.length, 2);
    assert.deepEqual([service.seen[1]!.key, service.seen[1]!.raw], [original.key, original.raw]);
    assert.equal(after.pending().length, 0);
    after.close();
  } finally {
    stop(service);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("journal HTTP : 200 (déjà écrite) passe ; refus, erreur ou silence lèvent JournalError", async () => {
  let status = 200;
  const service = await journalService(() => status);
  const journal = new HttpJournal(service.url);
  try {
    await journal.append(submitted("11"));
    // Refus définitif : signalé, gardé à part, jamais renvoyé, et il ne bloque pas la suite.
    for (status of [400, 409, 413]) {
      await assert.rejects(journal.append(submitted("11")), (error: unknown) => error instanceof JournalError && error.message.includes(String(status)));
    }
    assert.deepEqual(journal.refused().map((row) => row.http_status), [400, 409, 413]);
    assert.equal(journal.pending().length, 0);
    // Erreur du service : l'entrée attend.
    for (status of [500, 503]) {
      await assert.rejects(journal.flush().then(() => journal.append(submitted("22"))), (error: unknown) => error instanceof JournalError && error.message.includes(String(status)));
    }
    assert.equal(journal.pending().length, 1, "la première attend ; la seconde tentative a d'abord buté sur elle");
  } finally {
    stop(service);
  }
  // Service arrêté : injoignable, et le message ne porte pas l'URL.
  await assert.rejects(journal.flush(), (error: unknown) => error instanceof JournalError && error.message === "service de journal injoignable");
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

test("mise en file refusée faute de journal, puis remise : l'entrée en attente part d'abord, sous sa clé", async () => {
  let status = 503;
  const service = await journalService(() => status);
  const s = makeStack();
  try {
    const { Queue } = await import("../src/queue.ts");
    const { MemoryAlerts } = await import("../src/alerts.ts");
    const queue = new Queue({ path: ":memory:", policy: s.policy, clock: s.clock.now, journal: new HttpJournal(service.url), alerts: new MemoryAlerts() });
    const raw = JSON.stringify(await s.client.emit({ request_id: ID, agent_id: s.ids["A-DEM-1"]!, action: "PAY_INVOICE", ref_id: s.ids["F-001"]! }));
    await assert.rejects(queue.enqueue(raw), JournalError);
    assert.equal(queue.list().length, 0);
    status = 201;
    assert.equal((await queue.enqueue(raw)).status, "accepted");
    // Conséquence à connaître : la tentative refusée laisse son ENQUEUED, la
    // remise en file écrit le sien. Deux entrées, deux clés (README).
    const keys = service.seen.map((call) => call.key);
    assert.deepEqual([keys[1], keys[2] !== keys[0]], [keys[0], true]);
    assert.equal(service.seen.length, 3);
    queue.close();
  } finally {
    stop(service);
    s.close();
  }
});
