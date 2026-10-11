// GET /vault : les vues de specs/02 § 4 telles que le coffre les rend, sans
// calcul dans le relais. Forme attendue par dashboard/API-NEEDS.md § 1.
import assert from "node:assert/strict";
import { test } from "node:test";
import { API_HOST, createApi, listen } from "../src/api.ts";
import { ClosedVault, type VaultState } from "../src/vault.ts";
import { makeStack } from "./world.ts";

const KEYS = [
  "admitted_debts_wei", "block_number", "block_timestamp", "cash_wei", "held_placements_wei",
  "placeable_wei", "safety_reserve_wei", "threshold_wei", "total_held_wei", "vault_paused",
];

async function serve<T>(deps: Parameters<typeof createApi>[0], run: (base: string) => Promise<T>): Promise<T> {
  const server = createApi(deps);
  const port = await listen(server, 0);
  try {
    return await run(`http://${API_HOST}:${port}`);
  } finally {
    server.close();
  }
}

test("/vault : état neuf du monde de test, 100 en caisse, 40 de dettes, 40 de réserve, 20 plaçables", async () => {
  const s = makeStack();
  const u = (n: bigint): string => (n * s.unit).toString();
  await serve({ indexer: s.indexer, queue: s.queue, confirmations: 1, vault: s.vault }, async (base) => {
    const res = await fetch(`${base}/vault`);
    assert.equal(res.status, 200);
    const state = (await res.json()) as VaultState;
    assert.deepEqual(Object.keys(state).sort(), KEYS);
    assert.deepEqual(
      [state.cash_wei, state.admitted_debts_wei, state.safety_reserve_wei, state.total_held_wei, state.held_placements_wei, state.placeable_wei, state.threshold_wei],
      [u(100n), u(40n), u(40n), "0", "0", u(20n), u(25n)],
    );
    assert.equal(state.vault_paused, false);
    assert.ok(Number.isSafeInteger(state.block_number) && state.block_timestamp > 0);
    assert.equal((await fetch(`${base}/vault`, { method: "POST" })).status, 405);
  });
  s.close();
});

test("/vault : scénario 1 puis scénario 6, les valeurs suivent le coffre", async () => {
  const s = makeStack();
  const u = (n: bigint): string => (n * s.unit).toString();
  await serve({ indexer: s.indexer, queue: s.queue, confirmations: 1, vault: s.vault }, async (base) => {
    const read = async (): Promise<VaultState> => (await (await fetch(`${base}/vault`)).json()) as VaultState;

    await s.play("1");
    await s.relay.tick();
    let state = await read();
    // Payer une facture fait baisser ensemble le cash et les dettes : le plaçable ne bouge pas.
    assert.deepEqual([state.cash_wei, state.admitted_debts_wei, state.placeable_wei], [u(90n), u(30n), u(20n)]);

    await s.play("6");
    await s.relay.tick();
    state = await read();
    // Facture bloquée : toujours une dette admise, montant bloqué 30, plaçable inchangé.
    assert.deepEqual(
      [state.cash_wei, state.admitted_debts_wei, state.total_held_wei, state.held_placements_wei, state.placeable_wei],
      [u(90n), u(30n), u(30n), "0", u(20n)],
    );
  });
  s.close();
});

test("/vault : coffre injoignable ou fermé, 503 et aucune valeur ; sans coffre, 404", async () => {
  const s = makeStack();
  s.vault.fault = "down";
  await serve({ indexer: s.indexer, confirmations: 1, vault: s.vault }, async (base) => {
    const res = await fetch(`${base}/vault`);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "vault_unavailable" });
  });
  await serve({ indexer: s.indexer, confirmations: 1, vault: new ClosedVault("RPC_URL absent") }, async (base) => {
    assert.equal((await fetch(`${base}/vault`)).status, 503);
  });
  await serve({ indexer: s.indexer, confirmations: 1 }, async (base) => {
    assert.equal((await fetch(`${base}/vault`)).status, 404);
  });
  s.close();
});
