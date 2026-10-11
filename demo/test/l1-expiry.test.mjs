import assert from "node:assert/strict";
import { test } from "node:test";
import { waitForL1Expiry } from "../scenes.mjs";

const external = { mode: "chain", rpcUrl: "<RPC du L1>", get: () => "<RPC du L1>" };

test("expiration L1 : le temps mural ne suffit pas, attend un bloc strictement après l'échéance", async () => {
  const timestamps = [99, 100, 101];
  const seen = [];
  const pauses = [];
  await waitForL1Expiry(external, 100, {
    rpc: async (url, body) => {
      seen.push({ url, body });
      return { status: 200, body: { result: { timestamp: `0x${timestamps.shift().toString(16)}` } } };
    },
    pause: async (ms) => { pauses.push(ms); },
  });
  assert.equal(seen.length, 3);
  assert.deepEqual(pauses, [250, 250]);
  assert.ok(seen.every(({ body }) => body.method === "eth_getBlockByNumber"));
});

test("expiration locale ou fake : aucun RPC ni attente supplémentaire", async () => {
  for (const config of [{ ...external, get: () => undefined }, { ...external, mode: "fake" }]) {
    await waitForL1Expiry(config, 100, {
      rpc: async () => { assert.fail("RPC inattendu"); },
      pause: async () => { assert.fail("attente inattendue"); },
    });
  }
});

test("expiration L1 sans battement : erreur bornée, sans avance artificielle du temps", async () => {
  let polls = 0;
  await assert.rejects(waitForL1Expiry(external, 100, {
    rpc: async () => { polls += 1; return { status: 200, body: { result: { timestamp: "0x64" } } }; },
    pause: async () => {},
  }), /aucun bloc après l'échéance.*battement/);
  assert.equal(polls, 60);
});
