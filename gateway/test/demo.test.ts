import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { beforeEach, describe, it } from "node:test";
import { DEFAULT_POLICY } from "../src/config.ts";
import type { Action, Hex } from "../src/config.ts";
import { Gateway } from "../src/gateway.ts";
import { PauseTracker } from "../src/pauses.ts";
import { createGatewayServer } from "../src/server.ts";
import type { DemoHooks } from "../src/server.ts";
import { MemoryQuarantine, OutputLog } from "../src/stores.ts";
import { TokenRegistry } from "../src/tokens.ts";
import { MemoryJournal, fixtures } from "./helpers.ts";

const fx = fixtures();
const ID = (label: string): Hex => fx.ids[label] as Hex;
const LEGIT = "Facture synthétique. Merci de payer sous 30 jours.";

let now: number;
let journal: MemoryJournal;
let tokens: TokenRegistry;
let gateway: Gateway;
let outputs: OutputLog;

const issue = (label: string): string =>
  tokens.issue({ agent_id: ID(label), client_id: ID("C-DEMO"), mandate: ["PAY_INVOICE"] as Action[] }, 900);

const send = async (label: string, token: string): Promise<number> =>
  (
    await gateway.receive({
      authorization: `Bearer ${token}`,
      body: JSON.stringify({ agent_id: ID(label), client_id: ID("C-DEMO"), action: "PAY_INVOICE", ref_id: ID("F-001"), document: LEGIT }),
    })
  ).httpStatus;

beforeEach(() => {
  now = 1_800_000_000_000;
  journal = new MemoryJournal();
  tokens = new TokenRegistry(() => now);
  outputs = new OutputLog();
  gateway = new Gateway({
    policy: DEFAULT_POLICY,
    clock: () => (now += 3),
    tokens,
    pauses: new PauseTracker(tokens),
    journal,
    quarantine: new MemoryQuarantine(),
    onOutput: (output) => outputs.add(output),
  });
});

describe("remise à zéro de démo", () => {
  it("oublie les pauses quand le journal repart d'une chaîne neuve", async () => {
    const token = issue("A-DEM-2");
    assert.equal(await send("A-DEM-2", token), 202);
    await journal.append({
      type: "AGENT_PAUSED",
      component: "RESPONSE",
      request_id: null,
      agent_id: ID("A-DEM-2"),
      client_id: ID("C-DEMO"),
      data: { incident_id: ID("F-999"), scope: "OFFCHAIN", tx_hash: null },
    } as never);
    assert.equal(await send("A-DEM-2", token), 401);

    // Le service de réponse archive son journal : la chaîne repart de zéro.
    journal.entries = [];
    assert.equal(await send("A-DEM-2", token), 202);
  });

  it("garde les pauses tant que le journal ne fait que grandir", async () => {
    const token = issue("A-DEM-2");
    await journal.append({
      type: "AGENT_PAUSED",
      component: "RESPONSE",
      request_id: null,
      agent_id: ID("A-DEM-2"),
      client_id: ID("C-DEMO"),
      data: { incident_id: ID("F-999"), scope: "OFFCHAIN", tx_hash: null },
    } as never);
    assert.equal(await send("A-DEM-2", token), 401);
    assert.equal(await send("A-DEM-1", issue("A-DEM-1")), 202);
    assert.equal(await send("A-DEM-2", token), 401);
  });

  it("révoque les anciens jetons à la réémission", () => {
    const old = issue("A-DEM-1");
    tokens.revokeAll();
    const fresh = issue("A-DEM-1");
    assert.deepEqual(tokens.check(old), { ok: false, cause: "TOKEN_REVOKED" });
    assert.equal(tokens.check(fresh).ok, true);
  });
});

describe("route de démo", () => {
  async function withServer(demo: DemoHooks | undefined, run: (url: string) => Promise<void>): Promise<void> {
    const server = createGatewayServer(gateway, outputs, DEFAULT_POLICY.maxBodyBytes, demo);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await run(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  it("n'existe pas sans DEMO_MODE", async () => {
    await withServer(undefined, async (url) => {
      assert.equal((await fetch(`${url}/demo/reissue-tokens`, { method: "POST" })).status, 404);
      assert.deepEqual(await (await fetch(`${url}/health`)).json(), { status: "ok", outputs: 0, demo_mode: false });
    });
  });

  it("réémet les jetons avec DEMO_MODE", async () => {
    let calls = 0;
    await withServer({ reissueTokens: () => ((calls += 1), 5) }, async (url) => {
      const response = await fetch(`${url}/demo/reissue-tokens`, { method: "POST" });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { agents: 5 });
      assert.equal(calls, 1);
      assert.equal((await fetch(`${url}/demo/reissue-tokens`)).status, 405);
    });
  });
});
