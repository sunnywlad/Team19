import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bringUpChain, recordConsumedVault } from "../chain.mjs";
import { loadConfig, up } from "../lib.mjs";
import { accounts } from "../viem.mjs";

const address = `0x${"2".repeat(40)}`;
const keys = Object.fromEntries(["OWNER_PRIVATE_KEY", "ADMISSION_PRIVATE_KEY", "RELAYER", "APPROVER_PRIVATE_KEY", "GUARDIAN_PRIVATE_KEY", "CLIENT_SIGNER"].map((name) => [name, `0x${randomBytes(32).toString("hex")}`]));
const config = (env = {}) => loadConfig({ env: { VAULT_MODE: "chain", ...keys, ...env }, envFile: "/nonexistent/team19-test.env" });

function harness({ chainId = "0x2edaf", code = "0x6000" } = {}) {
  const calls = { started: [], stopped: [], commands: [], rpc: [], saved: [], consumed: [], order: [] };
  const deps = {
    start: async (service) => { calls.started.push(service); calls.order.push("start"); },
    stop: async (name) => { calls.stopped.push(name); },
    execute: (command, args, options) => { calls.commands.push({ command, args, options }); calls.order.push(command); return { status: 0 }; },
    rpc: async (url, body) => {
      calls.rpc.push({ url, body });
      calls.order.push(body.method);
      return { status: 200, body: { result: body.method === "eth_chainId" ? chainId : body.method === "anvil_setBalance" ? true : code } };
    },
    save: (vault) => { calls.saved.push(vault); },
    record: (vault) => { calls.consumed.push(vault); },
    read: () => JSON.stringify({ transactions: [{ contractName: "ArgentVault", contractAddress: address }] }),
  };
  return { calls, deps };
}

test("RPC externe : vérifie la chaîne et le code, sans lancer ni arrêter anvil, sans redéployer", async () => {
  const c = config({ RPC_URL: "<RPC du L1>", CHAIN_ID: "191919", VAULT_ADDRESS: address });
  const { calls, deps } = harness();
  await bringUpChain(c, deps);
  assert.deepEqual(calls.started, []);
  assert.deepEqual(calls.stopped, []);
  assert.deepEqual(calls.rpc.map(({ body }) => body.method), ["eth_chainId", "eth_getCode"]);
  assert.deepEqual(calls.saved, [address]);
  assert.equal(calls.commands.length, 1);
  assert.ok(calls.commands[0].args[0].endsWith("seed.mjs"));
  assert.equal(calls.commands[0].options.env.RPC_URL, c.rpcUrl);
  assert.equal(calls.commands[0].options.env.CHAIN_ID, "191919");
  assert.equal(calls.commands[0].options.env.VAULT_ADDRESS, address);
});

test("RPC externe d'une autre chaîne : arrêt clair avant tout service, déploiement ou seed", async () => {
  const { calls, deps } = harness({ chainId: "0x7a69" });
  await assert.rejects(bringUpChain(config({ RPC_URL: "<RPC du L1>", CHAIN_ID: "191919" }), deps), /chainId inattendu.*CHAIN_ID/);
  assert.deepEqual(calls.started, []);
  assert.deepEqual(calls.stopped, []);
  assert.deepEqual(calls.commands, []);
  assert.deepEqual(calls.saved, []);
});

test("VAULT_ADDRESS sans code : arrêt clair avant seed et sans toucher anvil", async () => {
  const { calls, deps } = harness({ code: "0x" });
  await assert.rejects(bringUpChain(config({ RPC_URL: "<RPC du L1>", CHAIN_ID: "191919", VAULT_ADDRESS: address }), deps), /VAULT_ADDRESS sans code/);
  assert.deepEqual(calls.started, []);
  assert.deepEqual(calls.stopped, []);
  assert.deepEqual(calls.commands, []);
});

test("sans RPC fourni : anvil local, déploiement et seed comme avant", async () => {
  const c = config();
  const { calls, deps } = harness();
  await bringUpChain(c, deps);
  assert.equal(c.rpcUrl, "http://127.0.0.1:8545");
  assert.equal(c.chainId, "31337");
  assert.deepEqual(calls.stopped, ["anvil"]);
  assert.equal(calls.started[0].name, "anvil");
  assert.deepEqual(calls.rpc.map(({ body }) => body.method), ["anvil_setBalance"]);
  assert.equal(calls.rpc[0].body.params[0].toLowerCase(), accounts.privateKeyToAccount(keys.OWNER_PRIVATE_KEY).address.toLowerCase());
  assert.deepEqual(calls.order.slice(0, 3), ["start", "anvil_setBalance", "forge"]);
  assert.equal(calls.commands.length, 2);
  assert.equal(calls.commands[0].command, "forge");
  assert.ok(calls.commands[0].args.includes(c.rpcUrl));
  assert.deepEqual(calls.saved, [address]);
  assert.ok(calls.commands[1].args[0].endsWith("seed.mjs"));
});

test("RPC externe sans VAULT_ADDRESS : forge déploie sur ce RPC, puis seed", async () => {
  const c = config({ RPC_URL: "<RPC du L1>", CHAIN_ID: "191919" });
  const { calls, deps } = harness();
  await bringUpChain(c, deps);
  assert.deepEqual(calls.started, []);
  assert.deepEqual(calls.stopped, []);
  assert.equal(calls.commands[0].command, "forge");
  assert.ok(calls.commands[0].args.includes(c.rpcUrl));
  assert.deepEqual(calls.saved, [address]);
  assert.equal(calls.commands[1].options.env.CHAIN_ID, "191919");
});

test("coffre neuf forcé : ignore VAULT_ADDRESS, déploie et note l'adresse consommée avant seed", async () => {
  const oldVault = `0x${"3".repeat(40)}`;
  const c = config({ RPC_URL: "<RPC du L1>", CHAIN_ID: "191919", VAULT_ADDRESS: oldVault });
  const { calls, deps } = harness();
  await bringUpChain(c, { ...deps, fresh: true });
  assert.deepEqual(calls.started, []);
  assert.deepEqual(calls.stopped, []);
  assert.deepEqual(calls.rpc.map(({ body }) => body.method), ["eth_chainId"]);
  assert.equal(calls.commands[0].command, "forge");
  assert.deepEqual(calls.consumed, [address]);
  assert.equal(calls.commands[1].options.env.VAULT_ADDRESS, address);
  assert.notEqual(calls.commands[1].options.env.VAULT_ADDRESS, oldVault);
});

test("registre des coffres consommés : conserve les métadonnées et n'ajoute que les adresses uniques", () => {
  const dir = mkdtempSync(join(tmpdir(), "vault-consumed-"));
  const file = join(dir, "deployments.json");
  try {
    writeFileSync(file, JSON.stringify({ chainId: 191919, vaults: { rehearsal: { address, status: "consommé" } } }));
    recordConsumedVault(address, file);
    recordConsumedVault(address, file);
    const next = `0x${"4".repeat(40)}`;
    recordConsumedVault(next, file);
    const record = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(record.chainId, 191919);
    assert.equal(record.vaults.rehearsal.status, "consommé");
    assert.deepEqual(record.consumedSceneVaults, [address, next]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const external of [false, true]) {
  test(`ports de up : ${external ? "RPC externe ne réserve pas anvil" : "mode local réserve toujours anvil"}`, async () => {
    const seen = [];
    const c = config({ DEMO_DASHBOARD: "0", ...(external ? { RPC_URL: "<RPC du L1>", CHAIN_ID: "191919" } : {}) });
    await assert.rejects(up(c, {
      check: () => {},
      state: async () => [],
      free: async (port) => { seen.push(port); return false; },
    }), /ports déjà pris/);
    assert.equal(seen.includes(8545), !external);
    assert.deepEqual(seen.filter((port) => port !== 8545), [8790, 8780, 8770, 8787]);
  });
}
