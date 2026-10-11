import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { bringUpChain } from "../chain.mjs";
import { loadConfig } from "../lib.mjs";

const address = `0x${"2".repeat(40)}`;
const keys = Object.fromEntries(["OWNER_PRIVATE_KEY", "ADMISSION_PRIVATE_KEY", "RELAYER", "APPROVER_PRIVATE_KEY", "GUARDIAN_PRIVATE_KEY", "CLIENT_SIGNER"].map((name) => [name, `0x${randomBytes(32).toString("hex")}`]));
const config = (env = {}) => loadConfig({ env: { VAULT_MODE: "chain", ...keys, ...env }, envFile: "/nonexistent/team19-test.env" });

function harness({ chainId = "0x2edaf", code = "0x6000" } = {}) {
  const calls = { started: [], stopped: [], commands: [], rpc: [], saved: [] };
  const deps = {
    start: async (service) => { calls.started.push(service); },
    stop: async (name) => { calls.stopped.push(name); },
    execute: (command, args, options) => { calls.commands.push({ command, args, options }); return { status: 0 }; },
    rpc: async (url, body) => {
      calls.rpc.push({ url, body });
      return { status: 200, body: { result: body.method === "eth_chainId" ? chainId : code } };
    },
    save: (vault) => { calls.saved.push(vault); },
    read: () => JSON.stringify({ transactions: [{ contractName: "ArgentVault", contractAddress: address }] }),
  };
  return { calls, deps };
}

test("RPC externe : vérifie la chaîne et le code, sans lancer ni arrêter anvil, sans redéployer", async () => {
  const c = config({ RPC_URL: "http://127.0.0.1:9670/rpc", CHAIN_ID: "191919", VAULT_ADDRESS: address });
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
  await assert.rejects(bringUpChain(config({ RPC_URL: "http://127.0.0.1:9670/rpc", CHAIN_ID: "191919" }), deps), /chainId inattendu.*CHAIN_ID/);
  assert.deepEqual(calls.started, []);
  assert.deepEqual(calls.stopped, []);
  assert.deepEqual(calls.commands, []);
  assert.deepEqual(calls.saved, []);
});

test("VAULT_ADDRESS sans code : arrêt clair avant seed et sans toucher anvil", async () => {
  const { calls, deps } = harness({ code: "0x" });
  await assert.rejects(bringUpChain(config({ RPC_URL: "http://127.0.0.1:9670/rpc", CHAIN_ID: "191919", VAULT_ADDRESS: address }), deps), /VAULT_ADDRESS sans code/);
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
  assert.deepEqual(calls.rpc, []);
  assert.equal(calls.commands.length, 2);
  assert.equal(calls.commands[0].command, "forge");
  assert.ok(calls.commands[0].args.includes(c.rpcUrl));
  assert.deepEqual(calls.saved, [address]);
  assert.ok(calls.commands[1].args[0].endsWith("seed.mjs"));
});

test("RPC externe sans VAULT_ADDRESS : forge déploie sur ce RPC, puis seed", async () => {
  const c = config({ RPC_URL: "http://127.0.0.1:9670/rpc", CHAIN_ID: "191919" });
  const { calls, deps } = harness();
  await bringUpChain(c, deps);
  assert.deepEqual(calls.started, []);
  assert.deepEqual(calls.stopped, []);
  assert.equal(calls.commands[0].command, "forge");
  assert.ok(calls.commands[0].args.includes(c.rpcUrl));
  assert.deepEqual(calls.saved, [address]);
  assert.equal(calls.commands[1].options.env.CHAIN_ID, "191919");
});
