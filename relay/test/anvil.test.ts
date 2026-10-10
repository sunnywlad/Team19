// Bout en bout sur une chaîne locale (anvil) : une demande signée atteint un
// contrat, et l'indexeur relit la décision. Le contrat est une DOUBLURE
// (test/fixtures/StubVault.sol) tant que contracts/ n'existe pas : ce test
// prouve l'encodage de submit() et le décodage de Decision, pas les règles du
// coffre. Ignoré si anvil ou forge sont absents.
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createPublicClient, createTestClient, createWalletClient, defineChain, http, parseEther, type Abi, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { MemoryAlerts } from "../src/alerts.ts";
import { ChainVault } from "../src/chain-vault.ts";
import { DEFAULT_POLICY, SPECS_DIR } from "../src/config.ts";
import { Indexer } from "../src/indexer.ts";
import { MemoryJournal } from "../src/journal.ts";
import { VaultPauseSource } from "../src/pauses.ts";
import { Queue } from "../src/queue.ts";
import { Relay } from "../src/relay.ts";
import { ClientSigner, domainFor } from "../src/signer.ts";
import { systemClock, type Hex, type SignedRequest } from "../src/types.ts";
import { fixtures } from "./helpers.ts";
import { freshRequestId } from "./world.ts";

const has = (tool: string): boolean => spawnSync(tool, ["--version"], { stdio: "ignore" }).status === 0;
const skip = has("anvil") && has("forge") ? false : "anvil ou forge absent";

const CHAIN_ID = 31337;
const port = 20000 + Math.floor(Math.random() * 20000);
const rpcUrl = `http://127.0.0.1:${port}`;
const chain = defineChain({ id: CHAIN_ID, name: "anvil", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
const transport = http(rpcUrl);
const publicClient = createPublicClient({ chain, transport });
const testClient = createTestClient({ chain, transport, mode: "anvil" });

// Clés tirées pour ce test, créditées par anvil_setBalance, jamais écrites.
// Les comptes préfinancés d'anvil ne sont pas utilisés : leurs clés sont publiques.
const relayerKey = generatePrivateKey();
const deployerKey = generatePrivateKey();
const strangerKey = generatePrivateKey();
const clientKey = generatePrivateKey();

const f = fixtures();
let anvil: ChildProcess | undefined;
let work: string | undefined;
let address: Address;
let client: ClientSigner;
let vault: ChainVault;

before(async () => {
  if (skip) return;
  work = mkdtempSync(join(tmpdir(), "relay-anvil-"));
  cpSync(join(SPECS_DIR, "contract/IArgentVault.sol"), join(work, "src/IArgentVault.sol"), { recursive: true });
  cpSync(new URL("./fixtures/StubVault.sol", import.meta.url), join(work, "src/StubVault.sol"));
  writeFileSync(join(work, "foundry.toml"), '[profile.default]\nsrc = "src"\nout = "out"\nsolc_version = "0.8.24"\n');
  const build = spawnSync("forge", ["build", "--root", work], { encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  const artifact = JSON.parse(readFileSync(join(work, "out/StubVault.sol/StubVault.json"), "utf8")) as { abi: Abi; bytecode: { object: Hex } };

  anvil = spawn("anvil", ["--port", String(port), "--chain-id", String(CHAIN_ID), "--silent"], { stdio: "ignore" });
  for (let i = 0; ; i += 1) {
    try {
      await publicClient.getChainId();
      break;
    } catch {
      if (i > 100) throw new Error("anvil ne répond pas");
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  for (const key of [relayerKey, deployerKey, strangerKey]) {
    await testClient.setBalance({ address: privateKeyToAccount(key).address, value: parseEther("1") });
  }
  const deployer = createWalletClient({ account: privateKeyToAccount(deployerKey), chain, transport });
  const hash = await deployer.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [f.ids["C-DEMO"]!, privateKeyToAccount(clientKey).address, privateKeyToAccount(relayerKey).address],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  address = receipt.contractAddress!;
  client = new ClientSigner(clientKey, f.ids["C-DEMO"]!, domainFor(CHAIN_ID, address), DEFAULT_POLICY, systemClock);
  vault = new ChainVault({ rpcUrl, chainId: CHAIN_ID, address, relayerKey });
});

after(() => {
  anvil?.kill();
  if (work) rmSync(work, { recursive: true, force: true });
});

const mined = (hash: Hex) => publicClient.waitForTransactionReceipt({ hash, pollingInterval: 50 });
async function sent(request: SignedRequest): Promise<Hex> {
  const outcome = await vault.submit(request);
  assert.equal(outcome.kind, "sent");
  return (outcome as { txHash: Hex }).txHash;
}
const intent = () => ({ request_id: freshRequestId(), agent_id: f.ids["A-DEM-1"]!, action: "PAY_INVOICE" as const, ref_id: f.ids["F-001"]! });

test("anvil : une demande signée atteint le contrat et sa décision est indexée", { skip }, async () => {
  const journal = new MemoryJournal(systemClock);
  const alerts = new MemoryAlerts();
  const queue = new Queue({ path: ":memory:", policy: DEFAULT_POLICY, clock: systemClock, journal, alerts });
  const relay = new Relay({ queue, vault, journal, alerts, pauses: new VaultPauseSource(vault), policy: DEFAULT_POLICY, clock: systemClock });
  const indexer = new Indexer({ path: ":memory:", vault, startBlock: 0n, confirmations: 1 });

  const request = await client.emit(intent());
  assert.equal((await queue.enqueue(JSON.stringify(request))).status, "accepted");
  assert.deepEqual(await relay.tick(), { submitted: 1, rejected: 0, deferred: 0, inDoubt: 0, expired: 0 });

  // Le relais n'attend pas le reçu ; le test, si, pour savoir quand miner.
  await mined(queue.byRequestId(request.request_id)[0]!.tx_hash!);
  assert.equal((await indexer.tick()).inserted, 0, "pas encore confirmée");
  await testClient.mine({ blocks: 1 });
  assert.equal((await indexer.tick()).inserted, 1);

  const decision = indexer.currentDecision(request.request_id)!;
  assert.deepEqual(
    [decision.decision, decision.reason_name, decision.agent_id, decision.client_id, decision.ref_id, decision.action],
    [2, "NONE", request.agent_id, request.client_id, request.ref_id, 1],
  );
  assert.equal(decision.tx_hash, queue.byRequestId(request.request_id)[0]!.tx_hash, "l'empreinte calculée avant l'envoi est celle de la chaîne");
  const block = await publicClient.getBlock({ blockNumber: BigInt(decision.block_number) });
  assert.equal(decision.block_timestamp, Number(block.timestamp));
  assert.deepEqual(journal.types(request.request_id), ["ENQUEUED", "SUBMITTED"]);

  // Rejeu direct, sans passer par la file : c'est le contrat qui refuse.
  await mined(await sent(request));
  await testClient.mine({ blocks: 1 });
  await indexer.tick();
  assert.deepEqual(indexer.decisions({ requestId: request.request_id }).map((d) => [d.decision, d.reason_name]), [[2, "NONE"], [0, "REQUEST_REPLAYED"]]);
  assert.equal((await indexer.tick()).inserted, 0, "relecture sans doublon");
  queue.close();
  indexer.close();
});

test("anvil : une demande retouchée en route est refusée par la signature", { skip }, async () => {
  const indexer = new Indexer({ path: ":memory:", vault, startBlock: await publicClient.getBlockNumber({ cacheTime: 0 }), confirmations: 0 });
  const request = { ...(await client.emit(intent())), ref_id: f.ids["F-002"]! };
  await mined(await sent(request));
  await indexer.tick();
  assert.equal(indexer.currentDecision(request.request_id)?.reason_name, "SIGNATURE_INVALID");
  indexer.close();
});

test("anvil : le relais lit la pause de l'agent sur la chaîne", { skip }, async () => {
  const other = f.ids["A-DEM-2"]!;
  assert.equal(await vault.agentPaused(other), false);
  const stranger = createWalletClient({ account: privateKeyToAccount(strangerKey), chain, transport });
  const hash = await stranger.writeContract({ address, abi: [{ type: "function", name: "pauseAgent", stateMutability: "nonpayable", inputs: [{ name: "agentId", type: "bytes32" }], outputs: [] }], functionName: "pauseAgent", args: [other] });
  await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(await vault.agentPaused(other), true);
});

test("anvil : échec fermé sans le bon rôle, sans clé, ou sans RPC", { skip }, async () => {
  const request = await client.emit(intent());
  const before = await publicClient.getBlockNumber({ cacheTime: 0 });

  const wrongRole = new ChainVault({ rpcUrl, chainId: CHAIN_ID, address, relayerKey: strangerKey });
  assert.equal((await wrongRole.submit(request)).kind, "not_sent", "NotAuthorized vu à la simulation : rien n'est diffusé");
  const noKey = new ChainVault({ rpcUrl, chainId: CHAIN_ID, address });
  assert.deepEqual(await noKey.submit(request), { kind: "not_sent", cause: "clé RELAYER absente" });
  const wrongChain = new ChainVault({ rpcUrl, chainId: 43113, address, relayerKey });
  assert.deepEqual(await wrongChain.submit(request), { kind: "not_sent", cause: "chainId inattendu" });
  const noRpc = new ChainVault({ rpcUrl: "http://127.0.0.1:9", chainId: CHAIN_ID, address, relayerKey, timeoutMs: 500 });
  assert.equal((await noRpc.submit(request)).kind, "not_sent");
  await assert.rejects(noRpc.agentPaused(request.agent_id));

  assert.equal(await publicClient.getBlockNumber({ cacheTime: 0 }), before, "aucune transaction n'est partie");
});
