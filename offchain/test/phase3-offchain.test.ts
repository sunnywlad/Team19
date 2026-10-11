// Scénarios d'intégration du lot 2 : registre, tirage de phase 3 et services.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { parseTransaction, toFunctionSelector, toHex } from 'viem';
import type { Hex, TransactionReceipt } from 'viem';

import {
  ANVIL_KEYS, CHAIN_ID, freePort, startAnvil, deployMockMarket, waitUntil,
  makePublicClient, makeWalletClient, listTxs,
} from './helpers/chain.ts';
import type { ChainTx } from './helpers/chain.ts';
import { deployPhase3Market, deployPhase3Registry } from './helpers/phase3.ts';
import { startCache } from '../cache/server.ts';
import { startGateway } from '../gateway/server.ts';
import { startVerifier } from '../verifier/service.ts';
import type { VerifierHandle } from '../verifier/service.ts';
import { validatePayload, deriveFacts } from '../lib/payload.ts';
import { postContent } from '../lib/cacheClient.ts';
import { marketAbi } from '../abi/market.ts';
import { drawnMarketAbi } from '../abi/drawnMarket.ts';
import { marketAbiWithErrors } from '../abi/marketErrors.ts';
import { registryAbi } from '../abi/registry.ts';
import { sendControlled } from '../lib/revert.ts';

const MIN_STAKE = 100n;
const TARGET_STAKE = 5n * MIN_STAKE;
const INITIAL_STAKE = 1000n;
const FEE = 100000000000000n;
const SELECTOR = {
  draw: toFunctionSelector('function drawCommittee(uint256)'),
  create: toFunctionSelector('function createRequest(bytes32)'),
  register: toFunctionSelector('function register()'),
  self: '0x' as Hex,
};
const REGISTRY_ADMIN_ABI = [
  { type: 'function', name: 'setMarket', stateMutability: 'nonpayable', inputs: [{ name: 'market_', type: 'address' }], outputs: [] },
  { type: 'function', name: 'admit', stateMutability: 'nonpayable', inputs: [{ name: 'account', type: 'address' }], outputs: [] },
  { type: 'function', name: 'revoke', stateMutability: 'nonpayable', inputs: [{ name: 'account', type: 'address' }], outputs: [] },
  { type: 'function', name: 'seize', stateMutability: 'nonpayable', inputs: [{ name: 'account', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'registered', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
] as const;

function payloadBytes(requester: string, nonce: string): Buffer {
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    requester: requester.toLowerCase(),
    agentId: 'phase3-test-agent',
    prompt: 'Pay invoice',
    context: {},
    plannedDecision: {
      action: 'pay', amountMinor: '50000', currency: 'EUR',
      beneficiaryId: 'FR7612345987650123456789014', reference: `INV-${nonce}`,
    },
    createdAt: 1700000000,
    salt: `0x${randomBytes(32).toString('hex')}`,
  }));
}

describe('phase 3 off-chain — tirage et registre', { concurrency: false }, () => {
  let anvilProc: Awaited<ReturnType<typeof startAnvil>>['proc'];
  let rpcUrl: string;
  let marketAddress: Hex;
  let registryAddress: Hex;
  let cacheUrl: string;
  let cacheStop: () => Promise<void>;
  let writeToken: string;
  let testRoot: string;
  let incidentsLog: string;
  let gatewayPort: number;
  let gatewayStop: () => Promise<void>;

  const [deployerKey, v0Key, v1Key, v2Key, requesterKey] = ANVIL_KEYS;
  const verifiers = [1, 2, 3].map(i => privateKeyToAccount(ANVIL_KEYS[i]!));
  const requester = privateKeyToAccount(requesterKey);
  const unadmitted = mnemonicToAccount('test test test test test test test test test test test junk', { addressIndex: 5 });
  const unadmittedKey = toHex(unadmitted.getHdKey().privateKey!);
  const verifierAddresses = verifiers.map(v => v.address.toLowerCase() as Hex);

  // Une pile par scénario : les commits, sels et verrous d'un test ne doivent
  // pas devenir un faux redémarrage sans état persistant dans le test suivant.
  beforeEach(async () => {
    testRoot = join(tmpdir(), `phase3-offchain-${randomBytes(4).toString('hex')}`);
    mkdirSync(testRoot, { recursive: true });
    incidentsLog = join(testRoot, 'incidents.log');
    const anvilPort = await freePort();
    ({ proc: anvilProc, rpcUrl } = await startAnvil(anvilPort));

    registryAddress = await deployPhase3Registry(rpcUrl, deployerKey, MIN_STAKE);
    marketAddress = await deployPhase3Market(rpcUrl, deployerKey, registryAddress, 12, 8, 3, FEE.toString());
    const admin = makeWalletClient(deployerKey, rpcUrl, CHAIN_ID);
    const pub = makePublicClient(rpcUrl, CHAIN_ID);
    const adminWrite = async (functionName: 'setMarket' | 'admit', args: readonly unknown[]) => {
      const hash = await admin.writeContract({
        address: registryAddress,
        abi: REGISTRY_ADMIN_ABI,
        functionName,
        args,
        gas: 300_000n,
      } as never);
      await assertSuccessfulReceipt(hash, `L'appel registre ${functionName} doit réussir avant les scénarios`);
    };
    await adminWrite('setMarket', [marketAddress]);
    for (const address of [...verifierAddresses, requester.address.toLowerCase() as Hex]) {
      await adminWrite('admit', [address]);
    }
    // Le demandeur est lui aussi inscrit : les tests doivent prouver qu'il est
    // exclu du pool, sinon le scénario à deux éligibles serait un faux positif.
    for (const key of [v0Key, v1Key, v2Key, requesterKey]) {
      const wallet = makeWalletClient(key, rpcUrl, CHAIN_ID);
      const hash = await wallet.writeContract({
        address: registryAddress, abi: registryAbi, functionName: 'register', args: [], value: INITIAL_STAKE, gas: 300_000n,
      });
      await assertSuccessfulReceipt(hash, 'Chaque compte admis doit commencer inscrit ; le demandeur sera exclu du tirage');
    }

    writeToken = `phase3-cache-${randomBytes(8).toString('hex')}`;
    const cachePort = await freePort();
    const cache = await startCache({
      port: cachePort, dataDir: join(testRoot, 'cache'), writeToken,
      rpcUrl, chainId: CHAIN_ID, marketAddress,
    });
    cacheStop = cache.stop;
    cacheUrl = `http://127.0.0.1:${cachePort}`;
    const started = await startGatewayFor(marketAddress, incidentsLog);
    gatewayPort = started.port;
    gatewayStop = started.stop;
  }, { timeout: 120_000 });

  afterEach(async () => {
    await gatewayStop?.();
    await cacheStop?.();
    anvilProc?.kill();
    if (testRoot) rmSync(testRoot, { recursive: true, force: true });
  });

  async function startGatewayFor(address: Hex, log: string): Promise<{ port: number; stop: () => Promise<void> }> {
    const port = await freePort();
    const result = await startGateway({
      port, apiKeys: ['phase3-api-key'], requesterKey,
      cacheUrl, cacheWriteToken: writeToken, rpcUrl, chainId: CHAIN_ID,
      marketAddress: address, incidentsLog: log,
    });
    return { port, stop: result.stop };
  }

  function startVerifierAt(key: Hex, dir: string, extra: Partial<Parameters<typeof startVerifier>[0]> = {}): VerifierHandle {
    return startVerifier({
      rpcUrl, chainId: CHAIN_ID, marketAddress, cacheUrl,
      verifierKey: key, registryAddress, dataDir: join(testRoot, dir),
      evaluatorCmd: 'node evaluator-stub/index.ts', incidentsLog, pollMs: 100,
      ...extra,
    });
  }

  async function postRequest(port = gatewayPort, nonce = randomBytes(3).toString('hex')) {
    const body = payloadBytes(requester.address, nonce);
    const response = await fetch(`http://127.0.0.1:${port}/requests`, {
      method: 'POST',
      headers: { Authorization: 'Bearer phase3-api-key', 'Content-Type': 'application/json' },
      body,
    });
    return { response, body: await response.json() as Record<string, unknown> };
  }

  async function manualRequest(nonce: string) {
    const bytes = payloadBytes(requester.address, nonce);
    const validated = validatePayload(bytes);
    const facts = deriveFacts(validated);
    const { h } = await postContent(cacheUrl, writeToken, bytes, facts);
    const wallet = makeWalletClient(requesterKey, rpcUrl, CHAIN_ID);
    const hash = await wallet.writeContract({
      address: marketAddress, abi: marketAbi, functionName: 'createRequest', args: [h as Hex], value: FEE, gas: 500_000n,
    });
    const receipt = await assertSuccessfulReceipt(hash, 'createRequest doit produire la demande avant le tirage différé');
    const logs = await makePublicClient(rpcUrl, CHAIN_ID).getContractEvents({
      address: marketAddress, abi: marketAbi, eventName: 'RequestCreated',
      fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber,
    });
    return { h: h as Hex, requestId: (logs[0]!.args as { requestId: bigint }).requestId, receipt };
  }

  function describeTxs(txs: ChainTx[]): string {
    const labels = Object.fromEntries(Object.entries(SELECTOR).map(([name, selector]) => [selector, name]));
    return txs.map(t => `${labels[t.selector] ?? t.selector}:${t.status}@${t.blockNumber}`).join(' ');
  }

  async function assertSuccessfulReceipt(hash: Hex, expected: string): Promise<TransactionReceipt> {
    const receipt = await makePublicClient(rpcUrl, CHAIN_ID).waitForTransactionReceipt({ hash });
    const seen = await listTxs(rpcUrl, receipt.blockNumber);
    assert.equal(receipt.status, 'success', `${expected}. Vu : ${describeTxs(seen)}`);
    return receipt;
  }

  async function eventsFor(eventName: 'CommitteeDrawn' | 'VerdictCommitted' | 'RequestClosed', requestId: bigint) {
    const logs = await makePublicClient(rpcUrl, CHAIN_ID).getContractEvents({
      address: marketAddress, abi: marketAbiWithErrors,
      eventName, fromBlock: 0n,
    } as never);
    return logs.filter(l => (l.args as { requestId?: bigint }).requestId === requestId);
  }

  async function phase3Balance(address: Hex): Promise<readonly [bigint, bigint]> {
    return makePublicClient(rpcUrl, CHAIN_ID).readContract({
      address: registryAddress, abi: registryAbi, functionName: 'stakeOf', args: [address],
    });
  }

  // Le proxy change seulement les conditions de bloc sur Anvil. Les écritures
  // restent celles de la passerelle, avec de vrais reçus et les règles du mock.
  async function proxyGateway(beforeSend: (raw: Hex) => Promise<void>) {
    const proxyPort = await freePort();
    const proxy = createServer(async (req, res) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks).toString();
        const rpc = JSON.parse(body);
        if (rpc.method === 'eth_sendRawTransaction') await beforeSend(rpc.params[0]);
        const upstream = await fetch(rpcUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        });
        res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
        res.end(await upstream.text());
      } catch (err) {
        res.writeHead(500);
        res.end(String(err));
      }
    });
    await new Promise<void>(resolve => proxy.listen(proxyPort, '127.0.0.1', resolve));
    const port = await freePort();
    const gateway = await startGateway({
      port, apiKeys: ['phase3-api-key'], requesterKey, cacheUrl,
      cacheWriteToken: writeToken, rpcUrl: `http://127.0.0.1:${proxyPort}`,
      chainId: CHAIN_ID, marketAddress, incidentsLog,
    });
    return {
      port,
      stop: async () => {
        await gateway.stop();
        await new Promise<void>((resolve, reject) => proxy.close(err => err ? reject(err) : resolve()));
      },
    };
  }

  async function anvilRpc(method: string, params: unknown[]) {
    const response = await fetch(rpcUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const body = await response.json() as { result?: unknown; error?: unknown };
    if (body.error) throw new Error(`${method} : ${JSON.stringify(body.error)}`);
    return body.result;
  }

  it('1. un tirage TooEarly est relancé jusqu’au reçu CommitteeDrawn', async () => {
    const before = await makePublicClient(rpcUrl, CHAIN_ID).getBlockNumber();
    const request = await manualRequest('early-draw-retry');
    const wallet = makeWalletClient(requesterKey, rpcUrl, CHAIN_ID);
    const early = await sendControlled({
      publicClient: makePublicClient(rpcUrl, CHAIN_ID), walletClient: wallet,
      address: marketAddress, abi: marketAbiWithErrors,
      call: { functionName: 'drawCommittee', args: [request.requestId] }, force: true,
    });
    const earlyTxs = await listTxs(rpcUrl, before + 1n);
    assert.equal(early.status, 'reverted', `Le premier tirage doit être reçu annulé TooEarly. Vu : ${describeTxs(earlyTxs)}`);
    if (early.status === 'reverted') {
      assert.equal(early.name, 'TooEarly', 'le reçu doit décoder l’erreur TooEarly');
      assert.equal(early.sent, true, `La transaction du premier tirage doit réellement avoir été envoyée. Vu : ${describeTxs(earlyTxs)}`);
    }
    const retry = await sendControlled({
      publicClient: makePublicClient(rpcUrl, CHAIN_ID), walletClient: wallet,
      address: marketAddress, abi: marketAbiWithErrors,
      call: { functionName: 'drawCommittee', args: [request.requestId] }, force: true,
    });
    const retryTxs = await listTxs(rpcUrl, before + 1n);
    assert.equal(retry.status, 'success', `La relance immédiate doit obtenir le comité sans transfert supplémentaire. Vu : ${describeTxs(retryTxs)}`);
    if (retry.status === 'success') {
      assert.equal(retry.receipt.status, 'success', `Le reçu de relance doit confirmer le tirage. Vu : ${describeTxs(retryTxs)}`);
      assert.ok(retry.receipt.blockNumber > request.receipt.blockNumber, 'le tirage doit arriver après la création');
    }
    assert.ok((await eventsFor('CommitteeDrawn', request.requestId)).length === 1, 'CommitteeDrawn doit être émis une seule fois après la relance');
    const directTxs = await listTxs(rpcUrl, before + 1n);
    const directDraws = directTxs.filter(t => t.selector === SELECTOR.draw);
    assert.equal(directDraws.length, 2, `le tirage précoce puis sa relance doivent être les deux seuls drawCommittee avant le POST. Vu : ${describeTxs(directTxs)}`);
    assert.deepEqual(directDraws.map(t => t.status), ['reverted', 'success'], `les reçus doivent être annulé puis réussi dans cet ordre. Vu : ${describeTxs(directTxs)}`);
    const { response } = await postRequest();
    assert.equal(response.status, 200, 'POST /requests doit aussi répondre après le tirage réussi du marché phase 3');
    const txs = await listTxs(rpcUrl, before + 1n);
    const draws = txs.filter(t => t.selector === SELECTOR.draw);
    assert.ok(draws.some(t => t.status === 'reverted'), `un reçu TooEarly annulé doit apparaître avant le tirage réussi. Vu : ${describeTxs(txs)}`);
    assert.ok(draws.some(t => t.status === 'success'), `une relance drawCommittee réussie doit apparaître. Vu : ${describeTxs(txs)}`);
  }, { timeout: 30_000 });

  it('2. RequestCreated précède CommitteeDrawn et le service relit h et les échéances', async () => {
    const { h, requestId, receipt } = await manualRequest('fallback-chain');
    const marker = await manualRequest('poll-marker');
    const wallet = makeWalletClient(requesterKey, rpcUrl, CHAIN_ID);
    const pad = await wallet.sendTransaction({ to: requester.address, value: 0n, gas: 21_000n });
    // Attendre le reçu pour empêcher le tirage de partager le bloc intermédiaire.
    const padReceipt = await assertSuccessfulReceipt(pad, 'Le bloc intermédiaire du marqueur doit être miné avant le tirage');
    const drawBlock = await makePublicClient(rpcUrl, CHAIN_ID).readContract({
      address: marketAddress, abi: drawnMarketAbi, functionName: 'drawBlock', args: [marker.requestId],
    });
    assert.ok(padReceipt.blockNumber >= drawBlock, `Bloc intermédiaire ${padReceipt.blockNumber} attendu au moins à drawBlock=${drawBlock}`);
    const markerDrawResult = await sendControlled({
      publicClient: makePublicClient(rpcUrl, CHAIN_ID), walletClient: wallet,
      address: marketAddress, abi: marketAbiWithErrors,
      call: { functionName: 'drawCommittee', args: [marker.requestId] }, force: true,
    });
    const markerTxs = await listTxs(rpcUrl, marker.receipt.blockNumber + 1n);
    assert.equal(markerDrawResult.status, 'success', `Le tirage marqueur doit être envoyé après simulation TooEarly. Vu : ${describeTxs(markerTxs)}`);
    const handle = startVerifierAt(v0Key, 'fallback-v0');
    try {
      await handle.ready;
      await waitUntil(() => handle.state.get(marker.requestId)?.step === 'committed', 15_000, 'le service traite le tirage marqueur et avance au-delà des deux RequestCreated');
      if (markerDrawResult.status === 'success') {
        assert.equal(markerDrawResult.receipt.status, 'success', `Tirage explicite du marqueur après drawBlock attendu. Vu : ${describeTxs(markerTxs)}`);
        assert.ok(markerDrawResult.receipt.blockNumber > drawBlock, `CommitteeDrawn du marqueur au bloc ${markerDrawResult.receipt.blockNumber} doit arriver après drawBlock=${drawBlock}`);
      }

      const drawHash = await wallet.writeContract({
        address: marketAddress, abi: drawnMarketAbi, functionName: 'drawCommittee', args: [requestId],
        gas: 1_500_000n,
      });
      const drawReceipt = await assertSuccessfulReceipt(drawHash, 'Tirage différé de la demande cible attendu');
      assert.ok(drawReceipt.blockNumber > receipt.blockNumber, 'CommitteeDrawn doit appartenir à un bloc postérieur à RequestCreated');
      await waitUntil(() => handle.state.get(requestId)?.step === 'committed', 15_000, 'commit du vérificateur après lecture du tirage postérieur');
      const state = handle.state.get(requestId)!;
      const chainRequest = await makePublicClient(rpcUrl, CHAIN_ID).readContract({
        address: marketAddress, abi: marketAbi, functionName: 'getRequest', args: [requestId],
      });
      assert.equal(state.h.toLowerCase(), h.toLowerCase(), 'h doit être relu depuis getRequest quand RequestCreated et CommitteeDrawn sont dans deux tours');
      assert.equal(state.commitDeadline, chainRequest.commitDeadline.toString(), 'commitDeadline doit venir de getRequest');
      assert.equal(state.revealDeadline, chainRequest.revealDeadline.toString(), 'revealDeadline doit venir de getRequest');
      const txs = await listTxs(rpcUrl, receipt.blockNumber + 1n);
      const draws = txs.filter(t => t.selector === SELECTOR.draw);
      assert.equal(draws.length, 2, `le marqueur et le tirage différé doivent tous deux réussir. Vu : ${describeTxs(txs)}`);
      assert.deepEqual(draws.map(t => t.status), ['success', 'success'], `les deux reçus de tirage doivent réussir. Vu : ${describeTxs(txs)}`);
    } finally { handle.stop(); }
  }, { timeout: 30_000 });

  it('3. redémarrer un vérificateur déjà inscrit ne dépose rien', async () => {
    const before = await makePublicClient(rpcUrl, CHAIN_ID).getBlockNumber();
    const first = startVerifierAt(v0Key, 'restart-v0');
    try { await first.ready; } finally { first.stop(); }
    const restarted = startVerifierAt(v0Key, 'restart-v0');
    try { await restarted.ready; } finally { restarted.stop(); }
    const txs = (await listTxs(rpcUrl, before + 1n)).filter(t => t.from === verifierAddresses[0]);
    assert.deepEqual(txs.filter(t => t.selector === SELECTOR.register), [], `aucun register ne doit être envoyé au redémarrage. Vu : ${describeTxs(txs)}`);
    const [total] = await phase3Balance(verifierAddresses[0]!);
    assert.equal(total, INITIAL_STAKE, 'la caution déjà déposée reste intacte au redémarrage');
  });

  it('4. après saisie sous minStake, le démarrage recomplète jusqu’à 5 × minStake', async () => {
    const admin = makeWalletClient(deployerKey, rpcUrl, CHAIN_ID);
    const pub = makePublicClient(rpcUrl, CHAIN_ID);
    // Registre isolé : les tirages des scénarios précédents gardent leurs verrous ouverts.
    const topupRegistry = await deployPhase3Registry(rpcUrl, deployerKey, MIN_STAKE);
    const admitHash = await admin.writeContract({ address: topupRegistry, abi: REGISTRY_ADMIN_ABI, functionName: 'admit', args: [verifierAddresses[0]!], gas: 300_000n });
    await assertSuccessfulReceipt(admitHash, 'v0 doit être admis dans le registre isolé du scénario de saisie');
    const initialDeposit = await makeWalletClient(v0Key, rpcUrl, CHAIN_ID).writeContract({
      address: topupRegistry, abi: registryAbi, functionName: 'register', args: [], value: TARGET_STAKE, gas: 300_000n,
    });
    await assertSuccessfulReceipt(initialDeposit, 'Le dépôt initial à 5 × minStake doit réussir');
    const seizeHash = await admin.writeContract({
      address: topupRegistry, abi: REGISTRY_ADMIN_ABI, functionName: 'seize',
      args: [verifierAddresses[0]!, TARGET_STAKE - 90n],
      gas: 300_000n,
    });
    await assertSuccessfulReceipt(seizeHash, 'La saisie de test doit placer la caution sous le seuil');
    assert.deepEqual(await pub.readContract({ address: topupRegistry, abi: registryAbi, functionName: 'stakeOf', args: [verifierAddresses[0]!] }), [90n, 0n], 'la saisie doit laisser 90, sous minStake=100');
    const before = await pub.getBlockNumber();
    const handle = startVerifierAt(v0Key, 'topup-v0', { registryAddress: topupRegistry });
    try { await handle.ready; } finally { handle.stop(); }
    assert.deepEqual(await pub.readContract({ address: topupRegistry, abi: registryAbi, functionName: 'stakeOf', args: [verifierAddresses[0]!] }), [TARGET_STAKE, 0n], 'le démarrage doit compléter la caution jusqu’à 5 × minStake');
    const txs = (await listTxs(rpcUrl, before + 1n)).filter(t => t.from === verifierAddresses[0]);
    assert.equal(txs.filter(t => t.selector === SELECTOR.register && t.status === 'success').length, 1, `un top-up register doit réussir. Vu : ${describeTxs(txs)}`);
  });

  it('5. une adresse non admise échoue au démarrage avec un message clair', async () => {
    const entry = fileURLToPath(new URL('../verifier/service.ts', import.meta.url));
    const child = spawn(process.execPath, [entry], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        RPC_URL: rpcUrl,
        CHAIN_ID: String(CHAIN_ID),
        MARKET_ADDRESS: marketAddress,
        REGISTRY_ADDRESS: registryAddress,
        CACHE_URL: cacheUrl,
        VERIFIER_KEY: unadmittedKey,
        VERIFIER_DATA_DIR: join(testRoot, 'non-admitted-process'),
        EVALUATOR_CMD: 'node evaluator-stub/index.ts',
        INCIDENTS_LOG: incidentsLog,
        POLL_MS: '100',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout!.on('data', data => { output += data.toString(); });
    child.stderr!.on('data', data => { output += data.toString(); });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    assert.equal(code, 1, 'le processus principal du vérificateur doit sortir avec le code 1 si l’adresse est refusée');
    assert.match(output, /Adresse vérificateur non admise au registre/, 'stderr doit expliquer que l’adresse n’est pas admise');
  });

  it('6. deux éligibles donnent POST 200, un seul tirage échoué et aucun incident', async () => {
    const admin = makeWalletClient(deployerKey, rpcUrl, CHAIN_ID);
    const revokeHash = await admin.writeContract({ address: registryAddress, abi: REGISTRY_ADMIN_ABI, functionName: 'revoke', args: [verifierAddresses[2]!], gas: 300_000n });
    await assertSuccessfulReceipt(revokeHash, 'Le troisième vérificateur doit être retiré pour produire deux éligibles');
    const before = await makePublicClient(rpcUrl, CHAIN_ID).getBlockNumber();
    const errors: string[] = [];
    const originalError = console.error;
    let posted;
    console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
    try { posted = await postRequest(); }
    finally { console.error = originalError; }
    const { response, body } = posted;
    assert.equal(response.status, 200, 'la demande reste acceptée sans comité lorsque le registre manque de vérificateurs');
    assert.ok(body['requestId'], 'la réponse doit conserver requestId même si le tirage échoue');
    const txs = await listTxs(rpcUrl, before + 1n);
    const drawTxs = txs.filter(t => t.selector === SELECTOR.draw);
    assert.equal(drawTxs.length, 1, `NotEnoughVerifiers ne doit pas être retenté. Vu : ${describeTxs(txs)}`);
    assert.equal(drawTxs[0]!.status, 'reverted', `Le tirage doit échouer avec seulement deux éligibles. Vu : ${describeTxs(txs)}`);
    assert.equal(existsSync(incidentsLog) ? readFileSync(incidentsLog, 'utf8') : '', '', 'NotEnoughVerifiers ne doit pas ouvrir le disjoncteur incidents.log');
    assert.equal(errors.length, 1, `Le manque d'éligibles produit une seule ligne d'erreur, vu : ${errors.join(' | ')}`);
    assert.match(errors[0]!, /NotEnoughVerifiers, éligibles=2/, 'Le journal doit donner le nombre décodé de deux éligibles');
    assert.deepEqual(Object.keys(body).sort(), ['requestId', 'h', 'txHash', 'commitDeadline', 'revealDeadline'].sort(), 'La réponse sans comité doit garder les cinq champs figés');
    const restoreHash = await admin.writeContract({ address: registryAddress, abi: REGISTRY_ADMIN_ABI, functionName: 'admit', args: [verifierAddresses[2]!], gas: 300_000n });
    await assertSuccessfulReceipt(restoreHash, 'Le troisième vérificateur doit être réadmis pour les scénarios suivants');
  }, { timeout: 30_000 });

  it('7. sur le marché phase 1, CommitteeDrawn est déjà dans createRequest et aucun tirage ne part', async () => {
    const phase1Address = await deployMockMarket(rpcUrl, deployerKey, verifierAddresses, 30, 20, 10, FEE.toString());
    const phase1Gateway = await startGatewayFor(phase1Address, join(testRoot, 'phase1-incidents.log'));
    try {
      const before = await makePublicClient(rpcUrl, CHAIN_ID).getBlockNumber();
      const { response, body } = await postRequest(phase1Gateway.port, 'phase1-market');
      assert.equal(response.status, 200, 'POST /requests doit rester compatible avec le marché phase 1');
      const txs = await listTxs(rpcUrl, before + 1n);
      assert.equal(txs.filter(t => t.selector === SELECTOR.draw).length, 0, `aucun drawCommittee ne doit partir si le reçu de création porte déjà CommitteeDrawn. Vu : ${describeTxs(txs)}`);
      assert.equal(txs.length, 1, `La phase 1 ne doit envoyer que createRequest, sans transfert vide. Vu : ${describeTxs(txs)}`);
      const id = BigInt(body['requestId'] as string);
      const logs = await makePublicClient(rpcUrl, CHAIN_ID).getContractEvents({
        address: phase1Address, abi: marketAbi, eventName: 'CommitteeDrawn', fromBlock: before + 1n,
      });
      assert.equal(logs.filter(l => (l.args as { requestId?: bigint }).requestId === id).length, 1, 'la création phase 1 doit inclure CommitteeDrawn');
    } finally { await phase1Gateway.stop(); }
  }, { timeout: 30_000 });

  it('8. close rend les verrous et permet le tirage d’une deuxième demande', async () => {
    const handles = [
      startVerifierAt(v0Key, 'repeat-v0'), startVerifierAt(v1Key, 'repeat-v1'), startVerifierAt(v2Key, 'repeat-v2'),
    ];
    try {
      await Promise.all(handles.map(h => h.ready));
      const first = await postRequest(gatewayPort, 'first-lock-cycle');
      assert.equal(first.response.status, 200, 'première demande avec tirage attendu');
      const firstId = BigInt(first.body['requestId'] as string);
      await waitUntil(async () => {
        const request = await makePublicClient(rpcUrl, CHAIN_ID).readContract({ address: marketAddress, abi: marketAbi, functionName: 'getRequest', args: [firstId] });
        return request.status === 4;
      }, 60_000, 'première demande Closed et trois verrous rendus');
      for (const address of verifierAddresses) {
        const [, locked] = await phase3Balance(address);
        assert.equal(locked, 0n, 'close doit rendre le verrou de chaque caution avant la demande suivante');
      }
      const second = await postRequest(gatewayPort, 'second-lock-cycle');
      assert.equal(second.response.status, 200, 'la deuxième demande doit pouvoir tirer un comité après le close');
      const secondId = BigInt(second.body['requestId'] as string);
      assert.equal((await eventsFor('CommitteeDrawn', secondId)).length, 1, 'la deuxième demande doit émettre son propre CommitteeDrawn');
      await waitUntil(async () => {
        const request = await makePublicClient(rpcUrl, CHAIN_ID).readContract({ address: marketAddress, abi: marketAbi, functionName: 'getRequest', args: [secondId] });
        return request.status === 4;
      }, 60_000, 'deuxième demande Closed après réutilisation des cautions');
      for (const address of verifierAddresses) {
        const [, locked] = await phase3Balance(address);
        assert.equal(locked, 0n, 'close de la deuxième demande doit aussi ramener le verrou à zéro');
      }
    } finally { handles.forEach(h => h.stop()); }
  }, { timeout: 140_000 });

  it('9. un comité tiré dans un ordre variable reçoit les trois commits', async () => {
    const handles = [
      startVerifierAt(v0Key, 'permutation-v0'), startVerifierAt(v1Key, 'permutation-v1'), startVerifierAt(v2Key, 'permutation-v2'),
    ];
    try {
      await Promise.all(handles.map(h => h.ready));
      const { response, body } = await postRequest(gatewayPort, 'permuted-committee');
      assert.equal(response.status, 200, 'la demande avec comité permuté doit être acceptée');
      const requestId = BigInt(body['requestId'] as string);
      const drawn = await eventsFor('CommitteeDrawn', requestId);
      assert.equal(drawn.length, 1, 'un comité tiré doit être inscrit sur la chaîne');
      const committee = (drawn[0]!.args as { committee: Hex[] }).committee.map(a => a.toLowerCase());
      assert.equal(new Set(committee).size, 3, 'le comité doit contenir trois adresses distinctes');
      await waitUntil(async () => (await eventsFor('VerdictCommitted', requestId)).length === 3, 20_000, 'VerdictCommitted des trois services pour le comité tiré');
      const commits = await eventsFor('VerdictCommitted', requestId);
      const senders = new Set(commits.map(l => (l.args as { verifier: Hex }).verifier.toLowerCase()));
      assert.deepEqual(senders, new Set(committee), 'les trois comptes du comité, quel que soit leur ordre, doivent envoyer un commit');
      assert.ok(committee.some((member, i) => member !== verifierAddresses[i]!.toLowerCase()), 'le cas doit avoir un ordre différent de la liste 1,2,3 pour prouver l’absence d’hypothèse sur l’index');
    } finally { handles.forEach(h => h.stop()); }
  }, { timeout: 45_000 });

  it('10. EVALUATOR_TIMEOUT_MS est plafonné à la moitié de commitWindow', async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
    const handle = startVerifierAt(v0Key, 'timeout-cap-v0', {
      evaluatorTimeoutMs: 90_000,
      evaluatorCmd: 'STUB_SLEEP_MS=90000 node evaluator-stub/index.ts',
    });
    try {
      await handle.ready;
      const before = await makePublicClient(rpcUrl, CHAIN_ID).getBlockNumber();
      const posted = await postRequest(gatewayPort, 'bounded-evaluator');
      assert.equal(posted.response.status, 200, 'Le service doit démarrer et recevoir une demande malgré le délai configuré trop long');
      const requestId = BigInt(posted.body.requestId as string);
      const request = await makePublicClient(rpcUrl, CHAIN_ID).readContract({
        address: marketAddress, abi: marketAbi, functionName: 'getRequest', args: [requestId],
      });
      const windowMs = Number(request.commitDeadline - request.createdAt) * 1000;
      await waitUntil(() => handle.state.get(requestId)?.step === 'committed', windowMs + 3000, 'L’évaluateur lent est coupé et le vote de délai est committé avant la fin de fenêtre');
      const state = handle.state.get(requestId)!;
      assert.equal(state.vote, 1, 'Un évaluateur dépassant la borne doit voter validation humaine');
      assert.equal(JSON.parse(state.detail).cause, 'evaluator_timeout', 'Le délai effectif doit réellement couper l’évaluateur, pas seulement produire un avertissement');
      assert.ok(warnings.some(line => line.includes(`réduit de 90000 à ${windowMs / 2} ms`)), `L’avertissement doit annoncer la moitié de la fenêtre lue sur chaîne. Capturé : ${warnings.join(' | ')}`);
      const txs = await listTxs(rpcUrl, before + 1n);
      const commits = txs.filter(tx => tx.from === verifierAddresses[0] && tx.selector === toFunctionSelector('function commitVerdict(uint256,bytes32)'));
      assert.equal(commits.length, 1, `Un commit doit effectivement être miné après le délai plafonné. Vu : ${describeTxs(txs)}`);
      assert.equal(commits[0]!.status, 'success', `Le commit doit réussir avant l’échéance. Vu : ${describeTxs(txs)}`);
      assert.ok(commits[0]!.timestamp < request.commitDeadline, `Le timeout doit laisser le temps de commit. Vu : ${describeTxs(txs)}`);
    }
    finally {
      handle.stop();
      console.warn = originalWarn;
    }
  }, { timeout: 30_000 });

  it('11. DrawRescheduled reprend le transfert vide puis obtient un seul comité', async () => {
    let expired = false;
    const proxy = await proxyGateway(async raw => {
      const tx = parseTransaction(raw);
      if (!expired && tx.to?.toLowerCase() === requester.address.toLowerCase() && !tx.data) {
        expired = true;
        // 257 blocs sans avancer l'heure : seul le blockhash du tirage expire.
        await anvilRpc('anvil_mine', ['0x101', '0x0']);
      }
    });
    try {
      const before = await makePublicClient(rpcUrl, CHAIN_ID).getBlockNumber();
      const posted = await postRequest(proxy.port, 'rescheduled-draw');
      assert.equal(posted.response.status, 200, `La route doit achever le tirage reprogrammé, réponse : ${JSON.stringify(posted.body)}`);
      assert.equal(expired, true, 'Le scénario doit effectivement avoir expiré le blockhash, sinon il ne teste aucune reprogrammation');
      const requestId = BigInt(posted.body.requestId as string);
      const rescheduled = await makePublicClient(rpcUrl, CHAIN_ID).getContractEvents({
        address: marketAddress, abi: marketAbiWithErrors, eventName: 'DrawRescheduled', fromBlock: before + 1n,
      });
      assert.equal(rescheduled.length, 1, 'Le premier tirage doit reprogrammer exactement une fois');
      assert.equal((await eventsFor('CommitteeDrawn', requestId)).length, 1, 'Après reprogrammation, le comité ne doit être tiré qu’une fois');
      const txs = await listTxs(rpcUrl, before + 258n);
      assert.equal(txs.filter(tx => tx.selector === SELECTOR.self).length, 2, `Un transfert vide avant chaque tirage est nécessaire à la reprogrammation. Vu : ${describeTxs(txs)}`);
      assert.deepEqual(txs.filter(tx => tx.selector === SELECTOR.draw).map(tx => tx.status), ['success', 'success'], `Reprogrammation puis comité acquis doivent avoir deux reçus réussis. Vu : ${describeTxs(txs)}`);
    } finally { await proxy.stop(); }
  }, { timeout: 30_000 });

  it('12. les reçus early du tirage arrêtent la route après cinq tentatives sans autre remplissage', async () => {
    let shifted = false;
    const proxy = await proxyGateway(async raw => {
      const tx = parseTransaction(raw);
      if (!shifted && tx.data?.startsWith(SELECTOR.draw)) {
        shifted = true;
        const request = await makePublicClient(rpcUrl, CHAIN_ID).readContract({
          address: marketAddress, abi: marketAbi, functionName: 'getRequest', args: [1n],
        });
        await anvilRpc('evm_setNextBlockTimestamp', [Number(request.commitDeadline) + 1]);
      }
    });
    try {
      const before = await makePublicClient(rpcUrl, CHAIN_ID).getBlockNumber();
      const posted = await postRequest(proxy.port, 'bounded-draw-retry');
      assert.equal(shifted, true, 'Le scénario doit réellement faire passer le validateur après commitDeadline');
      assert.equal(posted.response.status, 502, 'La route doit échouer clairement une fois les cinq tentatives épuisées');
      const txs = await listTxs(rpcUrl, before + 1n);
      const draws = txs.filter(tx => tx.selector === SELECTOR.draw);
      assert.equal(draws.length, 5, `La relance early ne doit dépasser aucune des cinq tentatives. Vu : ${describeTxs(txs)}`);
      assert.ok(draws.every(tx => tx.status === 'reverted'), `Les cinq tirages doivent être réellement annulés par WrongPhase. Vu : ${describeTxs(txs)}`);
      assert.equal(txs.filter(tx => tx.selector === SELECTOR.self).length, 1, `Un reçu early ne justifie pas de nouveau transfert vide. Vu : ${describeTxs(txs)}`);
    } finally { await proxy.stop(); }
  }, { timeout: 30_000 });
});
