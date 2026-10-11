import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { loadConfig } from "../lib.mjs";
import { seed } from "../seed.mjs";

const names = ["OWNER_PRIVATE_KEY", "ADMISSION_PRIVATE_KEY", "RELAYER", "APPROVER_PRIVATE_KEY", "GUARDIAN_PRIVATE_KEY", "CLIENT_SIGNER"];
const keys = Object.fromEntries(names.map((name) => [name, `0x${randomBytes(32).toString("hex")}`]));
const address = `0x${"2".repeat(40)}`;
const config = (chainId) => loadConfig({ env: { ...keys, VAULT_ADDRESS: address, CHAIN_ID: chainId, RPC_URL: "http://127.0.0.1:9670/rpc" }, envFile: "/nonexistent/team19-test.env" });

function harness() {
  const seen = { clients: 0, testClients: 0, balances: [], contracts: [] };
  return {
    seen,
    deps: {
      makeClients: () => { seen.clients += 1; return {}; },
      makeTestClient: () => {
        seen.testClients += 1;
        return { setBalance: async (args) => { seen.balances.push(args); } };
      },
      contractCall: async (_clients, vault, key, fn, args, value) => { seen.contracts.push({ vault, key, fn, args, value }); },
    },
  };
}

test("seed AWS : aucun client anvil ni crédit artificiel, paramètres et caisse du propriétaire", async () => {
  const { seen, deps } = harness();
  assert.equal(await seed(config("191919"), deps), 0);
  assert.equal(seen.testClients, 0);
  assert.deepEqual(seen.balances, []);
  assert.equal(seen.contracts.length, 16);
  const call = (fn) => seen.contracts.find((entry) => entry.fn === fn);
  assert.deepEqual(call("setSafetyReserve").args, [40_000_000_000_000_000n]);
  assert.deepEqual(call("setThreshold").args, [25_000_000_000_000_000n]);
  assert.deepEqual(call("setApprovalDelay").args, [30n]);
  assert.equal(call("fund").key, keys.OWNER_PRIVATE_KEY);
  assert.equal(call("fund").value, 100_000_000_000_000_000n);
  assert.equal(call("registerInvoice").key, keys.ADMISSION_PRIVATE_KEY);
  assert.ok(seen.contracts.every((entry) => entry.vault === address));
});

test("seed local : cinq rôles crédités sur anvil avant les mêmes seize inscriptions", async () => {
  const { seen, deps } = harness();
  assert.equal(await seed(config("31337"), deps), 0);
  assert.equal(seen.testClients, 1);
  assert.equal(seen.balances.length, 5);
  assert.ok(seen.balances.every(({ value }) => value === 1_000_000_000_000_000_000n));
  assert.equal(seen.contracts.length, 16);
});

test("seed sur une chaîne non autorisée : arrêt avant tout client et tout appel", async () => {
  const { seen, deps } = harness();
  await assert.rejects(seed(config("1"), deps), /chaîne de démo attendue/);
  assert.equal(seen.clients, 0);
  assert.equal(seen.testClients, 0);
  assert.deepEqual(seen.contracts, []);
});

test("seed : une erreur d'inscription arrête la suite et n'approvisionne pas le coffre", async () => {
  const { seen, deps } = harness();
  deps.contractCall = async (_clients, _vault, _key, fn) => {
    seen.contracts.push(fn);
    if (fn === "setThreshold") throw new Error("échec simulé");
  };
  assert.equal(await seed(config("191919"), deps), 1);
  assert.deepEqual(seen.contracts, ["setSafetyReserve", "setThreshold"]);
  assert.ok(!seen.contracts.includes("fund"));
});
