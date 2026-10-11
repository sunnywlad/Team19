// Ports de la démo : fixes, passés explicitement à chaque service. Un .env
// personnel ou l'environnement de l'appelant ne les déplacent pas (offchain/
// lit aussi GATEWAY_PORT, défaut 8700).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PORTS, loadConfig, services } from "../lib.mjs";

function withEnvFile(content, run) {
  const dir = mkdtempSync(join(tmpdir(), "demo-ports-"));
  try {
    writeFileSync(join(dir, ".env"), content, { mode: 0o600 });
    return run(join(dir, ".env"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("un .env avec GATEWAY_PORT=8700 ne déplace pas la porte", () => {
  withEnvFile("GATEWAY_PORT=8700\nJOURNAL_PORT=9999\nAPI_PORT=9998\nCLIENT_IA_PORT=9997\nDEMO_CONTROL_PORT=9996\nRPC_URL=http://203.0.113.7:8545\n", (envFile) => {
    const config = loadConfig({ env: {}, envFile });
    assert.deepEqual(config.ports, PORTS);
    assert.equal(config.url("gateway"), "http://127.0.0.1:8780");
    assert.equal(config.rpcUrl, "http://203.0.113.7:8545", "le RPC fourni dans .env est retenu sans déplacer les ports");
    assert.deepEqual(config.ignoredPorts, ["JOURNAL_PORT", "GATEWAY_PORT", "CLIENT_IA_PORT", "API_PORT", "DEMO_CONTROL_PORT"]);
    const gateway = services(config).find((s) => s.name === "gateway");
    assert.equal(gateway.port, 8780);
    assert.equal(gateway.env().GATEWAY_PORT, "8780");
    assert.equal(gateway.env().CLIENT_AI_URL, "http://127.0.0.1:8770/accepted");
  });
});

test("l'environnement de l'appelant ne déplace pas les ports non plus", () => {
  withEnvFile("", (envFile) => {
    const config = loadConfig({ env: { GATEWAY_PORT: "8700", JOURNAL_PORT: "1" }, envFile });
    assert.deepEqual(config.ports, PORTS);
    assert.deepEqual(config.ignoredPorts, ["JOURNAL_PORT", "GATEWAY_PORT"]);
  });
});

test("chaque service reçoit son port par sa propre variable", () => {
  withEnvFile("", (envFile) => {
    const config = loadConfig({ env: {}, envFile });
    const list = services(config);
    assert.deepEqual(list.map((s) => [s.name, s.port]), [["response", 8790], ["gateway", 8780], ["client-ia", 8770], ["relay", 8787], ["dashboard", 5173]]);
    assert.equal(list[0].env().JOURNAL_PORT, "8790");
    assert.equal(list[1].env().GATEWAY_PORT, "8780");
    // client-ia et relais lisent la clé de var/demo/ : leur port est contrôlé par make demo-smoke.
    assert.equal(list[4].env().RELAY_API_URL, "http://127.0.0.1:8787");
  });
});
