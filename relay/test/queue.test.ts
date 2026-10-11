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

// --- Expiration balayée par deux instances (relais et IA du client) ----------

/** Une demande en file, puis l'horloge au-delà de sa durée de vie. */
async function expiredInQueue(path: string) {
  const s = makeStack({}, { queue: path });
  const id = (await s.play("5")).detector.request_id;
  s.clock.advanceS(s.policy.demoTtlS + 1);
  return { s, id };
}

test("expiration : deux instances sur la même base, une seule expire, un seul QUEUE_EXPIRED", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-expire-"));
  const { Queue } = await import("../src/queue.ts");
  const { MemoryAlerts } = await import("../src/alerts.ts");
  const { expirySweeper } = await import("../src/client-ia.ts");
  try {
    const { s, id } = await expiredInQueue(join(dir, "queue.db"));
    // La seconde instance : celle de l'IA du client, même base, même journal.
    const other = new Queue({ path: join(dir, "queue.db"), policy: s.policy, clock: s.clock.now, journal: s.journal, alerts: new MemoryAlerts() });
    const sweep = expirySweeper(other);
    const counts = await Promise.all([sweep(), s.relay.tick().then((r) => r.expired), sweep(), s.queue.expire()]);
    assert.equal(counts.reduce((a, b) => a + b, 0), 1, "une seule expiration");
    assert.equal(await sweep(), 0);
    assert.equal((await s.relay.tick()).expired, 0);
    assert.deepEqual(s.journal.types(id).filter((t) => t === "QUEUE_EXPIRED"), ["QUEUE_EXPIRED"], "journalisé une fois");
    assert.equal(other.byRequestId(id)[0]!.status, "EXPIRED");
    assert.equal(s.vault.submissions, 0);
    other.close();
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("expiration : rien n'est journalisé si aucune ligne n'a changé", async () => {
  const s = makeStack();
  const id = (await s.play("5")).detector.request_id;
  assert.equal(await s.queue.expire(), 0, "avant l'échéance");
  s.clock.advanceS(s.policy.demoTtlS + 1);
  assert.equal(await s.queue.expire(), 1);
  assert.equal(await s.queue.expire(), 0);
  assert.equal(s.journal.types(id).filter((t) => t === "QUEUE_EXPIRED").length, 1);
  s.close();
});

test("expiration : deux PROCESSUS sur la même base, la somme fait un", async () => {
  const { spawn } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "relay-expire-"));
  try {
    const { s } = await expiredInQueue(join(dir, "queue.db"));
    const start = Date.now() + 1500;
    const worker = (): Promise<{ expired: number; journal: number }> =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(import.meta.dirname, "fixtures", "expire-worker.ts"), join(dir, "queue.db"), String(s.clock.ms), String(start)], { stdio: ["ignore", "pipe", "inherit"] });
        let out = "";
        child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
        child.once("exit", (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`processus de test sorti en ${code}`))));
      });
    const results = await Promise.all([worker(), worker(), worker()]);
    assert.equal(results.reduce((n, r) => n + r.expired, 0), 1, "une seule expiration");
    assert.equal(results.reduce((n, r) => n + r.journal, 0), 1, "un seul QUEUE_EXPIRED");
    // Le relais, relancé après coup, ne soumet pas la demande expirée.
    assert.deepEqual(await s.relay.tick(), { submitted: 0, rejected: 0, deferred: 0, inDoubt: 0, expired: 0 });
    assert.equal(s.vault.submissions, 0);
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
