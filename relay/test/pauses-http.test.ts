// Source de pause HTTP : la liste du service de réponse, lue par le relais
// avant toute soumission. Injoignable ou illisible : rien ne part.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { HttpPauseSource, PauseSourceError, VaultPauseSource, anyPause } from "../src/pauses.ts";
import { Relay } from "../src/relay.ts";
import type { Hex } from "../src/types.ts";
import { makeStack, type Stack } from "./world.ts";

type Service = { url: string; calls: () => number; server: Server; mode: "ok" | "down" | "garbage"; body: unknown };

async function pauseService(): Promise<Service> {
  let calls = 0;
  const service: Service = { url: "", calls: () => calls, server: undefined as unknown as Server, mode: "ok", body: [] };
  service.server = createServer((req, res) => {
    calls += 1;
    if (service.mode === "down") return void req.socket.destroy();
    if (req.method !== "GET" || req.url !== "/agents/paused") return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(service.mode === "garbage" ? "<html>" : JSON.stringify(service.body));
  });
  await new Promise<void>((resolve) => service.server.listen(0, "127.0.0.1", resolve));
  const address = service.server.address();
  service.url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  return service;
}

/** Une ligne de GET /agents/paused, telle que response/ la rend. */
const line = (agentId: Hex) => ({ agent_id: agentId, scope: "OFFCHAIN", incident_id: null, paused_at_ms: 1791662400000 });

/** Le relais de la pile, branché sur la source HTTP au lieu du bouchon. */
function relayWith(s: Stack, source: HttpPauseSource): Relay {
  return new Relay({ queue: s.queue, vault: s.vault, journal: s.journal, alerts: s.alerts, pauses: anyPause(source, new VaultPauseSource(s.vault)), policy: s.policy, clock: s.clock.now });
}

test("pause HTTP : agent en pause, la demande est écartée (AGENT_PAUSED) avant toute soumission", async () => {
  const service = await pauseService();
  const s = makeStack();
  try {
    service.body = [line(s.ids["A-DEM-1"]!)];
    const relay = relayWith(s, new HttpPauseSource(service.url, { clock: s.clock.now }));
    const played = await s.play("1");
    assert.deepEqual(await relay.tick(), { submitted: 0, rejected: 1, deferred: 0, inDoubt: 0, expired: 0 });
    const row = s.queue.byRequestId(played.detector.request_id)[0]!;
    assert.deepEqual([row.status, row.cause], ["REJECTED", "AGENT_PAUSED"]);
    assert.equal(s.vault.submissions, 0);
  } finally {
    service.server.close();
    s.close();
  }
});

test("pause HTTP : service coupé, la demande n'est pas envoyée ; service revenu, elle part", async () => {
  const service = await pauseService();
  const s = makeStack();
  try {
    const relay = relayWith(s, new HttpPauseSource(service.url, { clock: s.clock.now, timeoutMs: 300 }));
    const played = await s.play("1");
    const id = played.detector.request_id;

    service.mode = "down";
    assert.deepEqual(await relay.tick(), { submitted: 0, rejected: 0, deferred: 1, inDoubt: 0, expired: 0 });
    assert.equal(s.vault.submissions, 0);
    assert.equal(s.queue.byRequestId(id)[0]!.status, "PENDING");

    // Une réponse illisible vaut une panne : toujours rien.
    service.mode = "garbage";
    assert.equal((await relay.tick()).deferred, 1);
    assert.equal(s.vault.submissions, 0);

    // L'échec n'est pas gardé en cache : dès que le service répond, la demande part.
    service.mode = "ok";
    assert.deepEqual(await relay.tick(), { submitted: 1, rejected: 0, deferred: 0, inDoubt: 0, expired: 0 });
    assert.equal(s.vault.submissions, 1);
    assert.equal(s.queue.byRequestId(id)[0]!.status, "SUBMITTED");
  } finally {
    service.server.close();
    s.close();
  }
});

test("pause HTTP : service arrêté pour de bon, la demande attend puis expire sans être soumise", async () => {
  const service = await pauseService();
  service.server.close();
  const s = makeStack();
  const relay = relayWith(s, new HttpPauseSource(service.url, { clock: s.clock.now }));
  await s.play("1");
  assert.equal((await relay.tick()).deferred, 1);
  s.clock.advanceS(31);
  assert.equal((await relay.tick()).expired, 1);
  assert.equal(s.vault.submissions, 0);
  s.close();
});

test("pause HTTP : cache de 2 s au plus, une pause posée s'applique à la lecture suivante", async () => {
  const service = await pauseService();
  const s = makeStack();
  try {
    const agent = s.ids["A-DEM-1"]!;
    const source = new HttpPauseSource(service.url, { clock: s.clock.now });
    assert.equal(await source.isPaused(agent), false);
    service.body = [line(agent)];
    s.clock.ms += 1999;
    assert.equal(await source.isPaused(agent), false, "lecture de moins de 2 s : cache");
    assert.equal(service.calls(), 1);
    s.clock.ms += 1;
    assert.equal(await source.isPaused(agent), true, "2 s : relue");
    assert.equal(service.calls(), 2);
    // Passé le délai, un service coupé ne laisse pas l'ancienne liste répondre.
    s.clock.ms += 2000;
    service.mode = "down";
    await assert.rejects(source.isPaused(agent), PauseSourceError);
  } finally {
    service.server.close();
    s.close();
  }
});

test("pause HTTP : liste mal formée ou pleine, exception (jamais « pas en pause »)", async () => {
  const service = await pauseService();
  const s = makeStack();
  try {
    const agent = s.ids["A-DEM-1"]!;
    const read = () => new HttpPauseSource(service.url).isPaused(agent);
    for (const body of [{}, null, [{ agent_id: "A-DEM-1" }], [null], [{}]]) {
      service.body = body;
      await assert.rejects(read(), (error: unknown) => error instanceof PauseSourceError && !error.message.includes("127.0.0.1"));
    }
    // 200 lignes : la liste a pu être coupée par le service.
    service.body = Array.from({ length: 200 }, (_, i) => line(`0x${i.toString(16).padStart(64, "0")}` as Hex));
    await assert.rejects(read(), PauseSourceError);
    assert.throws(() => new HttpPauseSource("file:///etc/passwd"));
  } finally {
    service.server.close();
    s.close();
  }
});
