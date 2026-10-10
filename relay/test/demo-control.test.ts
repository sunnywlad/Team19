// Port de contrôle de démo : il n'existe qu'avec le faux coffre ET DEMO_MODE=1,
// et il laisse le faux coffre juger (échéance, demande inconnue).
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApi, listen } from "../src/api.ts";
import { REASON } from "../src/config.ts";
import { startDemoControl } from "../src/demo-control.ts";
import { FAKE_VAULT_NOTICE, vaultFromEnv } from "../src/runtime.ts";
import type { Hex } from "../src/types.ts";
import { lastDecision, makeStack, type Stack } from "./world.ts";

const FAKE_DEMO = { VAULT_MODE: "fake", DEMO_MODE: "1", DEMO_CONTROL_PORT: "0" };

async function post(port: number, path: string, body: unknown): Promise<{ status: number; body: { error?: string; called?: string } }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: (await response.json()) as { error?: string; called?: string } };
}

/** Scène 6 jouée jusqu'au montant bloqué, port de contrôle ouvert. */
async function held(): Promise<{ s: Stack; id: Hex; port: number; server: Server }> {
  const s = makeStack();
  const played = await s.play("6");
  await s.relay.tick();
  const id = played.detector.request_id;
  assert.deepEqual(await lastDecision(s, id), [1, REASON.ABOVE_THRESHOLD]);
  const control = await startDemoControl(s.vault, FAKE_DEMO);
  assert.ok(control);
  return { s, id, port: control.port, server: control.server };
}

test("port de contrôle : absent sans DEMO_MODE=1, absent sans faux coffre", async () => {
  const s = makeStack();
  assert.equal(await startDemoControl(s.vault, { VAULT_MODE: "fake", DEMO_CONTROL_PORT: "0" }), null, "sans DEMO_MODE");
  assert.equal(await startDemoControl(s.vault, { VAULT_MODE: "fake", DEMO_MODE: "0", DEMO_CONTROL_PORT: "0" }), null, "DEMO_MODE=0");
  assert.equal(await startDemoControl(s.vault, { DEMO_MODE: "1", DEMO_CONTROL_PORT: "0" }), null, "sans VAULT_MODE");
  assert.equal(await startDemoControl(s.vault, { VAULT_MODE: "chain", DEMO_MODE: "1", DEMO_CONTROL_PORT: "0" }), null, "mode chain");
  assert.equal(await startDemoControl(null, FAKE_DEMO), null, "sans faux coffre");
  s.close();
});

test("port de contrôle : l'API en lecture seule ne sert aucune route de démo", async () => {
  const s = makeStack();
  const api = createApi({ indexer: s.indexer, queue: s.queue, confirmations: 1, vault: s.vault });
  const port = await listen(api, 0);
  assert.equal((await post(port, "/demo/approve", { request_id: `0x${"1".repeat(64)}` })).status, 405);
  assert.equal((await fetch(`http://127.0.0.1:${port}/demo/approve`)).status, 404);
  api.close();
  s.close();
});

test("port de contrôle : approuver avant l'échéance paie", async () => {
  const { s, id, port, server } = await held();
  s.clock.advanceS(10);
  assert.equal((await post(port, "/demo/approve", { request_id: id })).status, 200);
  assert.deepEqual(await lastDecision(s, id), [2, REASON.APPROVED]);
  assert.equal(s.vault.cash, 70n * s.unit);
  const events = await s.vault.events(0n, await s.vault.blockNumber());
  assert.deepEqual(events.filter((e) => e.name === "Paid").map((e) => [e.args.refId, e.args.beneficiaryId, e.args.amount]), [[s.ids["F-002"], s.ids["B-002"], (30n * s.unit).toString()]]);
  server.close();
  s.close();
});

test("port de contrôle : expirer avant l'échéance est refusé, après l'échéance le coffre refuse la demande", async () => {
  const { s, id, port, server } = await held();
  s.clock.advanceS(29);
  const early = await post(port, "/demo/expire", { request_id: id });
  assert.deepEqual([early.status, early.body.error], [409, "DeadlineNotReached"]);
  assert.deepEqual(await lastDecision(s, id), [1, REASON.ABOVE_THRESHOLD], "rien n'a bougé");

  s.clock.advanceS(2);
  assert.equal((await post(port, "/demo/expire", { request_id: id })).status, 200);
  assert.deepEqual(await lastDecision(s, id), [0, REASON.APPROVAL_TIMEOUT]);
  const events = await s.vault.events(0n, await s.vault.blockNumber());
  assert.equal(events.filter((e) => e.name === "Paid").length, 0, "aucun paiement");
  assert.equal(events.filter((e) => e.name === "HoldReleased").length, 1);
  assert.equal(s.vault.cash, 100n * s.unit);
  assert.equal(s.vault.totalHeld(), 0n);
  server.close();
  s.close();
});

test("port de contrôle : approuver après l'échéance ne paie pas (6 c), refuser libère le montant", async () => {
  const late = await held();
  late.s.clock.advanceS(31);
  assert.equal((await post(late.port, "/demo/approve", { request_id: late.id })).status, 200);
  assert.deepEqual(await lastDecision(late.s, late.id), [0, REASON.APPROVAL_TIMEOUT]);
  assert.equal(late.s.vault.cash, 100n * late.s.unit);
  late.server.close();
  late.s.close();

  const refused = await held();
  assert.equal((await post(refused.port, "/demo/refuse", { request_id: refused.id })).status, 200);
  assert.deepEqual(await lastDecision(refused.s, refused.id), [0, REASON.APPROVAL_REFUSED]);
  refused.server.close();
  refused.s.close();
});

test("port de contrôle : tout le reste est refusé", async () => {
  const { s, id, port, server } = await held();
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/demo/approve`)).status, 405, "GET");
  assert.equal((await fetch(`${base}/demo/approve`, { method: "PUT" })).status, 405, "PUT");
  for (const path of ["/", "/health", "/vault", "/queue", "/demo", "/demo/reset", "/demo/pause"]) {
    assert.equal((await post(port, path, { request_id: id })).status, 404, path);
  }
  assert.equal((await post(port, "/demo/approve", { request_id: "F-002" })).status, 400);
  assert.equal((await post(port, "/demo/approve", {})).status, 400);
  const unknown = await post(port, "/demo/approve", { request_id: `0x${"2".repeat(64)}` });
  assert.deepEqual([unknown.status, unknown.body.error], [409, "NoPendingApproval"]);
  const web = await fetch(`${base}/demo/approve`, { method: "POST", headers: { origin: "http://exemple.invalid", "content-type": "application/json" }, body: JSON.stringify({ request_id: id }) });
  assert.equal(web.status, 403, "appel venu d'une page web");
  assert.deepEqual(await lastDecision(s, id), [1, REASON.ABOVE_THRESHOLD], "aucun de ces appels n'a touché au coffre");
  server.close();
  s.close();
});

// --- VAULT_MODE --------------------------------------------------------------

function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const names = ["VAULT_MODE", "CLIENT_SIGNER", "VAULT_ADDRESS", "RPC_URL", "RELAYER", "CHAIN_ID"];
  const saved = names.map((name) => [name, process.env[name]] as const);
  for (const name of names) delete process.env[name];
  for (const [name, value] of Object.entries(values)) if (value !== undefined) process.env[name] = value;
  try {
    return run();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("VAULT_MODE=fake : faux coffre dans l'état des fixtures", async () => {
  // Clé de test sans valeur : elle n'existe que dans ce processus.
  const key = `0x${"0".repeat(63)}7`;
  const { vault, note, fake } = withEnv({ VAULT_MODE: "fake", CLIENT_SIGNER: key, VAULT_ADDRESS: `0x${"1".repeat(40)}` }, vaultFromEnv);
  assert.equal(note, FAKE_VAULT_NOTICE);
  assert.equal(note, "COFFRE SIMULÉ : aucun fonds, aucune chaîne");
  assert.equal(vault, fake);
  const state = await vault.state();
  const unit = 10n ** 15n;
  assert.deepEqual(
    [state.cash_wei, state.admitted_debts_wei, state.safety_reserve_wei, state.placeable_wei, state.threshold_wei, state.total_held_wei],
    [100n, 40n, 40n, 20n, 25n, 0n].map((n) => (n * unit).toString()),
  );
});

test("VAULT_MODE : sans mode ou avec chain, comportement inchangé ; mode inconnu, démarrage en échec", () => {
  for (const mode of [undefined, "chain"]) {
    const { note, fake } = withEnv({ VAULT_MODE: mode }, vaultFromEnv);
    assert.equal(fake, null);
    assert.match(note, /^coffre fermé/);
  }
  assert.throws(() => withEnv({ VAULT_MODE: "FAKE" }, vaultFromEnv), /VAULT_MODE/);
  assert.throws(() => withEnv({ VAULT_MODE: "simulation" }, vaultFromEnv), /VAULT_MODE/);
  // Le faux coffre ne démarre pas sans la clé du client, et le message ne nomme que la variable.
  assert.throws(() => withEnv({ VAULT_MODE: "fake", VAULT_ADDRESS: `0x${"1".repeat(40)}` }, vaultFromEnv), /CLIENT_SIGNER$/);
});
