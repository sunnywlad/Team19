// Service « IA du client » : POST /accepted signe et dépose en file. Un test
// par code de réponse, puis l'idempotence sur request_id.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryAlerts } from "../src/alerts.ts";
import { API_HOST, listen } from "../src/api.ts";
import { createClientIa, type Accepted } from "../src/client-ia.ts";
import { HttpJournal } from "../src/http-journal.ts";
import { Queue } from "../src/queue.ts";
import { freshRequestId, makeStack, type Stack } from "./world.ts";

type Service = { s: Stack; url: string; post(body: unknown, headers?: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }>; close(): Promise<void> };

async function service(s: Stack = makeStack(), queue: Queue = s.queue, journal = s.journal as Parameters<typeof createClientIa>[0]["journal"]): Promise<Service> {
  const server = createClientIa({ client: s.client, clientId: s.ids["C-DEMO"]!, queue, journal });
  const url = `http://${API_HOST}:${await listen(server, 0)}`;
  return {
    s,
    url,
    async post(body, headers = { "content-type": "application/json" }) {
      const res = await fetch(`${url}/accepted`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      s.close();
    },
  };
}

const accepted = (s: Stack, over: Partial<Accepted> = {}): Accepted => ({
  request_id: freshRequestId(),
  agent_id: s.ids["A-DEM-1"]!,
  client_id: s.ids["C-DEMO"]!,
  action: "PAY_INVOICE",
  ref_id: s.ids["F-001"]!,
  ...over,
});

test("client-ia 202 : la demande est signée, journalisée, mise en file, et le coffre accepte la signature", async () => {
  const c = await service();
  const { s } = c;
  try {
    const body = accepted(s);
    const res = await c.post(body);
    assert.equal(res.status, 202);
    assert.deepEqual(res.body, { status: "accepted", request_id: body.request_id, duplicate: false }, "ni signature ni contenu dans la réponse");

    const row = s.queue.byRequestId(body.request_id)[0]!;
    assert.equal(row.status, "PENDING");
    const signed = s.queue.payload(row.id)!.request;
    assert.deepEqual({ request_id: signed.request_id, agent_id: signed.agent_id, client_id: signed.client_id, action: signed.action, ref_id: signed.ref_id }, body);
    assert.equal(signed.expires_at - signed.issued_at, s.policy.demoTtlS);
    assert.deepEqual(s.journal.types(body.request_id), ["REQUEST_SIGNED", "ENQUEUED"]);

    // Bout en bout : le relais soumet, le coffre reconnaît le signataire et paie.
    assert.equal((await s.relay.tick()).submitted, 1);
    await s.index();
    assert.equal(s.indexer.currentDecision(body.request_id)?.reason_name, "NONE");
  } finally {
    await c.close();
  }
});

test("client-ia 400 : champ inconnu, manquant ou mal typé, et rien n'est signé", async () => {
  const c = await service();
  const { s } = c;
  try {
    const good = accepted(s);
    const { ref_id: _omitted, ...missing } = good;
    const bad: unknown[] = [
      { ...good, amount_wei: "1" }, // le montant ne voyage jamais dans une demande
      { ...good, beneficiary_id: s.ids["B-001"] },
      { ...good, document: "texte" },
      missing,
      { ...good, action: "WITHDRAW" },
      { ...good, action: 1 },
      { ...good, agent_id: "A-DEM-1" },
      { ...good, request_id: `0x${"0".repeat(64)}` },
      { ...good, ref_id: good.ref_id.toUpperCase() },
      { ...good, client_id: s.ids["A-DEM-1"] }, // un autre client que celui de la clé
      [good],
      "pas du json",
      null,
    ];
    for (const body of bad) {
      const res = await c.post(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(Object.keys(res.body), ["error"], "le contenu reçu n'est jamais renvoyé");
    }
    assert.equal((await c.post(good, { "content-type": "text/plain" })).status, 400, "type de contenu");
    assert.equal((await c.post({ ...good, pad: "x".repeat(5000) })).status, 400, "corps trop long");
    assert.equal(s.queue.list().length, 0);
    assert.deepEqual(s.journal.types(), []);
  } finally {
    await c.close();
  }
});

test("client-ia 502 : file indisponible (journal coupé), rien n'entre en file", async () => {
  const s = makeStack();
  // Journal réel injoignable : la file refuse d'enregistrer sans lui.
  const journal = new HttpJournal("http://127.0.0.1:9", 200);
  const queue = new Queue({ path: ":memory:", policy: s.policy, clock: s.clock.now, journal, alerts: new MemoryAlerts() });
  const c = await service(s, queue, journal);
  try {
    const res = await c.post(accepted(s));
    assert.equal(res.status, 502);
    assert.deepEqual(res.body, { error: "queue_unavailable" });
    assert.equal(queue.list().length, 0);
  } finally {
    queue.close();
    await c.close();
  }
});

test("client-ia 502 : base de la file fermée", async () => {
  const s = makeStack();
  const queue = new Queue({ path: ":memory:", policy: s.policy, clock: s.clock.now, journal: s.journal, alerts: new MemoryAlerts() });
  const c = await service(s, queue);
  try {
    queue.close();
    assert.equal((await c.post(accepted(s))).status, 502);
    assert.equal(s.vault.submissions, 0);
  } finally {
    await c.close();
  }
});

test("client-ia : idempotent sur request_id, une seule signature et une seule entrée en file", async () => {
  const c = await service();
  const { s } = c;
  try {
    const body = accepted(s);
    assert.equal((await c.post(body)).status, 202);
    const first = s.queue.payload(s.queue.byRequestId(body.request_id)[0]!.id)!.raw;
    s.clock.advanceS(3);
    // Reprise de la porte, y compris en rafale : même réponse, aucun effet.
    const again = await Promise.all([c.post(body), c.post(body), c.post(body)]);
    for (const res of again) assert.deepEqual([res.status, res.body.duplicate], [202, true]);
    assert.equal(s.queue.byRequestId(body.request_id).length, 1);
    assert.equal(s.queue.payload(s.queue.byRequestId(body.request_id)[0]!.id)!.raw, first, "la demande en file n'a pas bougé");
    assert.deepEqual(s.journal.types(body.request_id), ["REQUEST_SIGNED", "ENQUEUED"]);

    // Même request_id, autre contenu : refusé, la demande en file ne bouge pas.
    const other = await c.post({ ...body, ref_id: s.ids["F-002"]! });
    assert.deepEqual([other.status, other.body], [400, { error: "request_id_conflict" }]);
    assert.equal(s.queue.byRequestId(body.request_id).length, 1);

    // Toujours idempotent après la soumission : pas de seconde demande.
    await s.relay.tick();
    assert.equal((await c.post(body)).status, 202);
    assert.equal((await s.relay.tick()).submitted, 0);
    assert.equal(s.vault.submissions, 1);
  } finally {
    await c.close();
  }
});

test("client-ia : rafale du même request_id jamais vu, une seule signature", async () => {
  const c = await service();
  const { s } = c;
  try {
    const body = accepted(s);
    const all = await Promise.all([c.post(body), c.post(body), c.post(body), c.post(body)]);
    assert.deepEqual(all.map((r) => r.status), [202, 202, 202, 202]);
    assert.equal(all.filter((r) => r.body.duplicate === false).length, 1);
    assert.deepEqual(s.journal.types(body.request_id), ["REQUEST_SIGNED", "ENQUEUED"]);
  } finally {
    await c.close();
  }
});

test("client-ia : lié à 127.0.0.1, POST seulement, aucun appel venu d'une page web", async () => {
  const c = await service();
  const { s } = c;
  try {
    const body = accepted(s);
    assert.equal((await fetch(`${c.url}/accepted`)).status, 405);
    assert.equal((await fetch(`${c.url}/autre`, { method: "POST" })).status, 404);
    assert.equal((await c.post(body, { "content-type": "application/json", origin: "http://exemple.invalid" })).status, 403);
    assert.equal(s.queue.list().length, 0);
  } finally {
    await c.close();
  }
});
