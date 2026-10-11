// Le propriétaire est financé sur anvil avant le déploiement : une clé générée
// (cast wallet new) n'a aucun solde sur un anvil neuf, et forge script échoue
// avec « Insufficient funds » (-32003). Seule la clé de dev d'anvil passait.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { accounts } from "../viem.mjs";
import { fundOwner } from "../chain.mjs";

/** Un faux RPC qui enregistre les appels reçus et répond null, comme anvil. */
async function withFakeRpc(run) {
  const calls = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const call = JSON.parse(body);
      calls.push(call);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: null }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`, calls);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("une clé propriétaire aléatoire reçoit un solde via anvil_setBalance", async () => {
  const key = `0x${randomBytes(32).toString("hex")}`;
  const owner = accounts.privateKeyToAccount(key).address;
  await withFakeRpc(async (rpcUrl, calls) => {
    await fundOwner(rpcUrl, key);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "anvil_setBalance");
    assert.equal(calls[0].params[0].toLowerCase(), owner.toLowerCase());
    assert.ok(BigInt(calls[0].params[1]) > 0n, "solde strictement positif");
  });
});

test("le financement ne nomme jamais la clé privée dans l'appel RPC", async () => {
  const key = `0x${randomBytes(32).toString("hex")}`;
  await withFakeRpc(async (rpcUrl, calls) => {
    await fundOwner(rpcUrl, key);
    assert.ok(!JSON.stringify(calls).includes(key.slice(2)));
  });
});

test("un refus RPC arrête le déploiement sans révéler la réponse", async () => {
  const key = `0x${randomBytes(32).toString("hex")}`;
  await assert.rejects(
    fundOwner("<RPC anvil>", key, async () => ({ status: 200, body: { error: { message: "détail sensible" } } })),
    (error) => error.message === "financement du propriétaire sur anvil en échec",
  );
});
