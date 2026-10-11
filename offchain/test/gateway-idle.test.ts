// test/gateway-idle.test.ts — la passerelle (POST /requests/{id}/finalize) sur une chaîne inactive
//
// Le L1 ne produit un bloc qu'à chaque transaction. Sans trafic, block.timestamp reste
// figé, getRequest rend Commit pour toujours et toute simulation échoue en WrongPhase
// ou TooEarly. La route finalize décide sur l'horloge murale et envoie à gaz fixe, ce qui
// force un bloc à l'heure courante.
//
// Ces tests reproduisent cet état sans le L1 : le vrai VerificationMarket sur anvil
// (minage à la transaction, eth_call sur le dernier bloc), l'horloge murale, aucune
// avance de temps, aucun evm_mine, aucune transaction du test hors création de la demande.
//
// Scénarios, enchaînés sur la même demande :
//   1. Avant revealDeadline : 200, Commit, aucune transaction envoyée
//   2. Après revealDeadline : 200, Contest, HumanReview, une seule finalize réussie
//   3. Rappel immédiat : 200, Contest, aucune nouvelle transaction
//   4. Après contestDeadline : 200, Closed, un seul close réussi, statut 4 sur la chaîne
//   5. Sur toute la durée : uniquement des appels finalize et close vers le marché

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { toFunctionSelector } from 'viem';
import type { Hex } from 'viem';

import {
  ANVIL_KEYS, CHAIN_ID, freePort, startAnvil, deployRealMarket, sleep,
  makePublicClient, listTxs,
} from './helpers/chain.ts';
import type { ChainTx } from './helpers/chain.ts';
import { startCache } from '../cache/server.ts';
import { startGateway } from '../gateway/server.ts';
import { marketAbi } from '../abi/market.ts';

// Fenêtres en secondes réelles : les tests attendent l'horloge murale.
const COMMIT_WINDOW = 4;
const REVEAL_WINDOW = 4;
const CONTEST_WINDOW = 4;

const STATUS_CLOSED = 4;

const SEL = {
  create:   toFunctionSelector('function createRequest(bytes32)'),
  commit:   toFunctionSelector('function commitVerdict(uint256,bytes32)'),
  reveal:   toFunctionSelector('function revealVerdict(uint256,uint8,uint16,bytes32,bytes32)'),
  finalize: toFunctionSelector('function finalize(uint256)'),
  close:    toFunctionSelector('function close(uint256)'),
};

function wallNow(): number {
  return Math.floor(Date.now() / 1000);
}

type FinalizeBody = {
  status: string;
  code?: string;
  deadlines: { commit: string; reveal: string; contest: string };
};

describe('gateway — finalize sur chaîne inactive (vrai marché, horloge murale)', { concurrency: false }, () => {
  let anvilProc: Awaited<ReturnType<typeof startAnvil>>['proc'];
  let rpcUrl: string;
  let marketAddress: Hex;
  let market: Hex; // en minuscules, pour comparer aux transactions
  let cacheStop: () => Promise<void>;
  let gatewayStop: () => Promise<void>;
  let gatewayPort: number;
  let apiKey: string;
  let testRoot: string;

  // État partagé entre scénarios : la même demande de bout en bout.
  let requestId: bigint;
  let revealDeadline: number;
  let fromBlock: bigint;
  let contestDeadline: number;
  let txsAfterScenario2 = 0;

  // Comptes : 0=deployer, 1..3=comité, 4=demandeur
  const [deployerKey, v0Key, v1Key, v2Key, requesterKey] = ANVIL_KEYS;
  const v0 = privateKeyToAccount(v0Key);
  const v1 = privateKeyToAccount(v1Key);
  const v2 = privateKeyToAccount(v2Key);
  const requester = privateKeyToAccount(requesterKey);

  const client = () => makePublicClient(rpcUrl, CHAIN_ID);
  const gwUrl = (path: string) => `http://127.0.0.1:${gatewayPort}${path}`;
  const authHeaders = (extra: Record<string, string> = {}) => ({ 'Authorization': `Bearer ${apiKey}`, ...extra });

  function describeTxs(txs: ChainTx[]): string {
    const names = Object.fromEntries(Object.entries(SEL).map(([k, v]) => [v, k]));
    return `[${txs.map(t => `${names[t.selector] ?? t.selector}:${t.status}@${t.timestamp}`).join(' ')}]`;
  }

  async function postFinalize(): Promise<{ status: number; body: FinalizeBody }> {
    const res = await fetch(gwUrl(`/requests/${requestId}/finalize`), {
      method: 'POST',
      headers: authHeaders(),
    });
    const body = await res.json() as FinalizeBody;
    return { status: res.status, body };
  }

  async function waitWallClock(target: number): Promise<void> {
    while (wallNow() < target) await sleep(250);
  }

  before(async () => {
    testRoot = join(tmpdir(), 'gateway-idle-' + randomBytes(4).toString('hex'));
    mkdirSync(testRoot, { recursive: true });

    const anvilPort = await freePort();
    ({ proc: anvilProc, rpcUrl } = await startAnvil(anvilPort));

    marketAddress = await deployRealMarket(
      rpcUrl, deployerKey, [v0.address, v1.address, v2.address],
      COMMIT_WINDOW, REVEAL_WINDOW, CONTEST_WINDOW,
    );
    market = marketAddress.toLowerCase() as Hex;

    const writeToken = 'cache-write-' + randomBytes(8).toString('hex');
    apiKey = 'gw-api-' + randomBytes(8).toString('hex');

    const cacheDataDir = join(testRoot, 'cache-data');
    mkdirSync(cacheDataDir, { recursive: true });
    const cachePort = await freePort();
    const cacheResult = await startCache({
      port: cachePort,
      dataDir: cacheDataDir,
      writeToken,
      rpcUrl,
      chainId: CHAIN_ID,
      marketAddress,
      securityAddresses: [],
    });
    cacheStop = cacheResult.stop;

    gatewayPort = await freePort();
    const gwResult = await startGateway({
      port: gatewayPort,
      apiKeys: [apiKey],
      requesterKey,
      cacheUrl: `http://127.0.0.1:${cachePort}`,
      cacheWriteToken: writeToken,
      rpcUrl,
      chainId: CHAIN_ID,
      marketAddress,
      incidentsLog: join(testRoot, 'incidents.log'),
    });
    gatewayStop = gwResult.stop;

    // Création de la demande : la seule transaction du test. Aucun vérificateur ne tourne.
    const payload = {
      schemaVersion: 1,
      requester: requester.address.toLowerCase(),
      agentId: 'test-agent',
      prompt: 'Pay INV-001',
      context: {},
      plannedDecision: {
        action: 'pay', amountMinor: '50000', currency: 'EUR',
        beneficiaryId: 'FR7612345987650123456789014', reference: 'INV-001',
      },
      createdAt: 1700000000,
      salt: '0x' + randomBytes(32).toString('hex'),
    };
    const res = await fetch(gwUrl('/requests'), {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 200, 'POST /requests doit rendre 200 : sans demande, le test ne peut pas démarrer');
    const body = await res.json() as { requestId: string; commitDeadline: string; revealDeadline: string };
    requestId = BigInt(body.requestId);
    revealDeadline = Number(body.revealDeadline);
    fromBlock = (await client().getBlockNumber()) + 1n;
  }, { timeout: 120_000 });

  after(async () => {
    await gatewayStop?.();
    await cacheStop?.();
    anvilProc?.kill();
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('1. avant revealDeadline : 200, Commit, aucune transaction envoyée', async () => {
    assert.ok(
      wallNow() < revealDeadline,
      `précondition : l'horloge murale (${wallNow()}) doit précéder revealDeadline (${revealDeadline}), sinon le scénario ne teste rien`,
    );
    const { status, body } = await postFinalize();
    assert.equal(status, 200, 'finalize avant l\'échéance doit rendre 200 (résultat, pas erreur)');
    assert.equal(body.status, 'Commit', 'la demande doit rester en Commit avant revealDeadline');

    const txs = await listTxs(rpcUrl, fromBlock);
    assert.deepEqual(
      txs, [],
      `avant l'échéance la passerelle ne doit forcer aucune transaction vouée à l'annulation. Vu : ${describeTxs(txs)}`,
    );
  }, { timeout: 60_000 });

  it('2. horloge murale >= revealDeadline + 1, sans autre trafic : Contest, HumanReview, une finalize réussie', async () => {
    await waitWallClock(revealDeadline + 1);
    const { status, body } = await postFinalize();
    assert.equal(status, 200, 'finalize après l\'échéance doit rendre 200');
    assert.equal(body.status, 'Contest', 'la transaction forcée doit faire passer la demande en Contest malgré la chaîne inactive');
    assert.equal(body.code, 'HumanReview', 'aucun reveal : le code doit être HumanReview');
    assert.notEqual(body.deadlines.contest, '0', 'deadlines.contest doit être la valeur de la chaîne, jamais 0');
    contestDeadline = Number(body.deadlines.contest);

    const txs = await listTxs(rpcUrl, fromBlock);
    txsAfterScenario2 = txs.length;
    const okFinalize = txs.filter(t => t.selector === SEL.finalize && t.status === 'success');
    assert.equal(okFinalize.length, 1, `exactement une finalize réussie attendue. Vu : ${describeTxs(txs)}`);
  }, { timeout: 60_000 });

  it('3. rappel immédiat avant contestDeadline : Contest, aucune nouvelle transaction', async () => {
    assert.ok(
      wallNow() < contestDeadline,
      `précondition : l'horloge murale (${wallNow()}) doit précéder contestDeadline (${contestDeadline})`,
    );
    const before = await listTxs(rpcUrl, fromBlock);
    const { status, body } = await postFinalize();
    assert.equal(status, 200, 'le rappel de finalize doit rendre 200');
    assert.equal(body.status, 'Contest', 'la demande doit rester en Contest avant contestDeadline');

    const after = await listTxs(rpcUrl, fromBlock);
    assert.equal(
      after.length, before.length,
      `aucune nouvelle transaction attendue (ni close, ni finalize annulée). Avant : ${describeTxs(before)} Après : ${describeTxs(after)}`,
    );
    assert.equal(
      after.length, txsAfterScenario2,
      `le nombre de transactions doit rester celui du scénario 2. Vu : ${describeTxs(after)}`,
    );
  }, { timeout: 60_000 });

  it('4. horloge murale >= contestDeadline + 1 : Closed, un close réussi, statut 4 sur la chaîne', async () => {
    await waitWallClock(contestDeadline + 1);
    const { status, body } = await postFinalize();
    assert.equal(status, 200, 'finalize après contestDeadline doit rendre 200');
    assert.equal(body.status, 'Closed', 'la passerelle doit envoyer close et rendre Closed');

    const txs = await listTxs(rpcUrl, fromBlock);
    const okClose = txs.filter(t => t.selector === SEL.close && t.status === 'success');
    assert.equal(okClose.length, 1, `exactement un close réussi attendu. Vu : ${describeTxs(txs)}`);

    const onChain = await client().readContract({
      address: marketAddress, abi: marketAbi, functionName: 'getRequest', args: [requestId],
    });
    assert.equal(onChain.status, STATUS_CLOSED, 'getRequest(id).status lu sur la chaîne doit valoir 4 (Closed)');
  }, { timeout: 60_000 });

  it('5. sur toute la durée : uniquement des appels finalize et close vers le marché', async () => {
    const txs = await listTxs(rpcUrl, fromBlock);
    assert.ok(txs.length > 0, 'précondition : les scénarios précédents ont envoyé au moins une transaction');
    const foreign = txs.filter(t => t.to !== market || (t.selector !== SEL.finalize && t.selector !== SEL.close));
    assert.deepEqual(
      foreign, [],
      `transaction de remplissage interdite : chaque transaction doit viser le marché avec finalize ou close. Vu : ${describeTxs(txs)}`,
    );
  }, { timeout: 60_000 });
});
