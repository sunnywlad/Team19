// test/verifier-idle.test.ts — le service vérificateur sur une chaîne inactive
//
// Le L1 ne produit un bloc qu'à chaque transaction. Entre deux transactions,
// block.timestamp est figé : getRequest rend Commit pour toujours et toute
// simulation échoue en WrongPhase ou TooEarly.
//
// Ces tests reproduisent cet état sans le L1 : le vrai VerificationMarket sur anvil
// (minage à la transaction, eth_call sur le dernier bloc), l'horloge murale, aucune
// avance de temps, aucun autre trafic que celui du service.
//
// Limite mesurée : sur anvil, eth_estimateGas s'exécute à l'heure courante, pas sur le
// dernier bloc. Un envoi sans gaz fixe y passe donc, alors qu'il échoue sur le L1. Le
// scénario 1 garde le chemin nominal ; la preuve que close part sur une chaîne inactive
// est e2e.sh avec E2E_EXPECT_CLOSED=1. Les scénarios 2 à 4 échouent sur le code d'avant.
//
// Scénarios :
//   1. Cycle complet sans autre trafic : 3 reveals, finalize, close réellement envoyé
//   2. Horloge du service en avance sur la chaîne : une annulation ne fait pas avancer l'étape
//   3. Commit manqué : la demande rejoint finalize puis close
//   4. Erreur définitive (CommitmentMismatch) : un incident, aucune relance, la demande continue

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { toFunctionSelector } from 'viem';
import type { Hex } from 'viem';

import {
  ANVIL_KEYS, CHAIN_ID, freePort, startAnvil, deployRealMarket, sleep,
  makePublicClient, makeWalletClient, waitUntil, listTxs,
} from './helpers/chain.ts';
import type { ChainTx } from './helpers/chain.ts';
import { startCache } from '../cache/server.ts';
import { validatePayload, deriveFacts } from '../lib/payload.ts';
import { marketAbi } from '../abi/market.ts';
import { postContent } from '../lib/cacheClient.ts';
import { startVerifier } from '../verifier/service.ts';
import type { VerifierHandle } from '../verifier/service.ts';

// Fenêtres en secondes réelles : les tests attendent l'horloge murale.
const COMMIT_WINDOW = 6;
const REVEAL_WINDOW = 6;
const CONTEST_WINDOW = 3;

const STATUS = { None: 0, Commit: 1, Reveal: 2, Contest: 3, Closed: 4 } as const;

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

describe('verifier service — chaîne inactive (vrai marché, horloge murale)', { concurrency: false }, () => {
  let anvilProc: Awaited<ReturnType<typeof startAnvil>>['proc'];
  let rpcUrl: string;
  let marketAddress: Hex;
  let market: Hex; // en minuscules, pour comparer aux transactions
  let cacheStop: () => Promise<void>;
  let cacheUrl: string;
  let writeToken: string;
  let testRoot: string;

  // Comptes : 0=deployer, 1..3=comité, 4=demandeur
  const [deployerKey, v0Key, v1Key, v2Key, requesterKey] = ANVIL_KEYS;
  const v0 = privateKeyToAccount(v0Key);
  const v1 = privateKeyToAccount(v1Key);
  const v2 = privateKeyToAccount(v2Key);
  const requester = privateKeyToAccount(requesterKey);
  const v0Addr = v0.address.toLowerCase() as Hex;

  before(async () => {
    testRoot = join(tmpdir(), 'verifier-idle-' + randomBytes(4).toString('hex'));
    mkdirSync(testRoot, { recursive: true });

    const anvilPort = await freePort();
    ({ proc: anvilProc, rpcUrl } = await startAnvil(anvilPort));

    marketAddress = await deployRealMarket(
      rpcUrl, deployerKey, [v0.address, v1.address, v2.address],
      COMMIT_WINDOW, REVEAL_WINDOW, CONTEST_WINDOW,
    );
    market = marketAddress.toLowerCase() as Hex;

    const cacheDataDir = join(testRoot, 'cache-data');
    mkdirSync(cacheDataDir, { recursive: true });
    writeToken = 'test-token-' + randomBytes(8).toString('hex');
    const cachePort = await freePort();
    cacheUrl = `http://127.0.0.1:${cachePort}`;
    const { stop } = await startCache({
      port: cachePort, dataDir: cacheDataDir, writeToken,
      rpcUrl, chainId: CHAIN_ID, marketAddress,
    });
    cacheStop = stop;
  }, { timeout: 120_000 });

  after(async () => {
    await cacheStop();
    anvilProc.kill();
    rmSync(testRoot, { recursive: true, force: true });
  });

  // ── Utilitaires ──

  const client = () => makePublicClient(rpcUrl, CHAIN_ID);

  // Dépose le contenu au cache et crée la demande. C'est la dernière transaction
  // étrangère au service : après elle, seule l'activité des vérificateurs produit des blocs.
  async function createRequest(amountMinor: string): Promise<{
    requestId: bigint; commitDeadline: number; revealDeadline: number; fromBlock: bigint;
  }> {
    const payloadBytes = Buffer.from(JSON.stringify({
      schemaVersion: 1,
      requester: requester.address.toLowerCase(),
      agentId: 'test-agent',
      prompt: 'Pay invoice',
      context: {},
      plannedDecision: {
        action: 'pay', amountMinor, currency: 'EUR',
        beneficiaryId: 'FR7612345987650123456789014', reference: 'INV-001',
      },
      createdAt: 1700000000,
      salt: '0x' + randomBytes(32).toString('hex'),
    }));
    const facts = deriveFacts(validatePayload(payloadBytes));
    const { h } = await postContent(cacheUrl, writeToken, payloadBytes, facts);

    const wallet = makeWalletClient(requesterKey, rpcUrl, CHAIN_ID);
    const fee = await client().readContract({
      address: marketAddress, abi: marketAbi, functionName: 'requestFee',
    });
    const txHash = await wallet.writeContract({
      address: marketAddress, abi: marketAbi, functionName: 'createRequest',
      args: [h as Hex], value: fee as bigint,
    });
    const receipt = await client().waitForTransactionReceipt({ hash: txHash });
    assert.equal(receipt.status, 'success', 'createRequest annulée : le test ne peut pas démarrer');

    const logs = await client().getContractEvents({
      address: marketAddress, abi: marketAbi, eventName: 'RequestCreated',
      fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber,
    });
    const args = logs[0].args as { requestId?: bigint; commitDeadline?: bigint; revealDeadline?: bigint };
    return {
      requestId: args.requestId!,
      commitDeadline: Number(args.commitDeadline!),
      revealDeadline: Number(args.revealDeadline!),
      fromBlock: receipt.blockNumber + 1n,
    };
  }

  function start(key: Hex, name: string, incidentsLog: string, extra: Partial<Parameters<typeof startVerifier>[0]> = {}): VerifierHandle {
    // Pas d'option `now` par défaut : le service tourne sur l'horloge murale, comme en production.
    return startVerifier({
      rpcUrl, chainId: CHAIN_ID, marketAddress, cacheUrl, verifierKey: key,
      dataDir: join(testRoot, name), pollMs: 200,
      evaluatorCmd: 'node evaluator-stub/index.ts',
      incidentsLog,
      ...extra,
    });
  }

  async function onChainStatus(requestId: bigint): Promise<number> {
    const r = await client().readContract({
      address: marketAddress, abi: marketAbi, functionName: 'getRequest', args: [requestId],
    });
    return r.status;
  }

  async function eventsFor(eventName: 'VerdictCommitted' | 'VerdictRevealed' | 'RequestFinalized' | 'RequestClosed' | 'VerifierMissed', requestId: bigint) {
    const logs = await client().getContractEvents({
      address: marketAddress, abi: marketAbi, eventName, fromBlock: 0n,
    });
    return logs.filter(l => (l.args as { requestId?: bigint }).requestId === requestId);
  }

  function incidentLines(path: string): Record<string, unknown>[] {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8').split('\n').filter(l => l.trim() !== '').map(l => JSON.parse(l));
  }

  function describeTxs(txs: ChainTx[]): string {
    const names = Object.fromEntries(Object.entries(SEL).map(([k, v]) => [v, k]));
    return txs.map(t => `${names[t.selector] ?? t.selector}:${t.status}@${t.timestamp}`).join(' ');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Cycle complet sans autre trafic
  // ═══════════════════════════════════════════════════════════════════════════

  it('1. sans autre trafic : 3 reveals, finalize, puis close réellement envoyé (statut Closed)', async () => {
    const incidentsLog = join(testRoot, 'incidents-1.log');
    const { requestId, fromBlock } = await createRequest('50000');
    const handles = [
      start(v0Key, 'v0-t1', incidentsLog),
      start(v1Key, 'v1-t1', incidentsLog),
      start(v2Key, 'v2-t1', incidentsLog),
    ];

    try {
      await waitUntil(
        async () => (await eventsFor('VerdictRevealed', requestId)).length >= 3,
        25_000, '3 VerdictRevealed alors que la chaîne lit encore Commit par eth_call',
      );
      await waitUntil(
        async () => (await onChainStatus(requestId)) === STATUS.Closed,
        30_000, 'statut Closed sur la chaîne (close doit partir en transaction, pas seulement dans l\'état local)',
      );

      const finalized = await eventsFor('RequestFinalized', requestId);
      assert.equal(finalized.length, 1, 'un seul RequestFinalized attendu');
      assert.equal((finalized[0].args as { code?: number }).code, 2, 'code 2 (Accept) attendu : les 3 votent 2');
      assert.equal((await eventsFor('RequestClosed', requestId)).length, 1, 'un RequestClosed attendu');

      const txs = await listTxs(rpcUrl, fromBlock);
      const foreign = txs.filter(t => t.to !== market || !Object.values(SEL).includes(t.selector));
      assert.deepEqual(
        foreign, [],
        `transaction de remplissage interdite : toute transaction doit être un appel du marché. Vu : ${describeTxs(txs)}`,
      );
      const okClose = txs.filter(t => t.selector === SEL.close && t.status === 'success');
      assert.equal(okClose.length, 1, `un seul close réussi attendu. Vu : ${describeTxs(txs)}`);

      await waitUntil(
        () => handles.every(h => h.state.get(requestId)?.step === 'closed'),
        10_000, 'étape closed dans l\'état des 3 vérificateurs',
      );
      assert.deepEqual(
        incidentLines(incidentsLog), [],
        'aucun incident attendu sur le chemin nominal : une ligne ici coupe la passerelle (disjoncteur)',
      );
    } finally {
      handles.forEach(h => h.stop());
    }
  }, { timeout: 90_000 });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Horloge du service en avance sur celle de la chaîne (cas du validateur AWS)
  // ═══════════════════════════════════════════════════════════════════════════

  it('2. horloge en avance de 5 s : les transactions annulées ne font avancer aucune étape', async () => {
    const incidentsLog = join(testRoot, 'incidents-2.log');
    const { requestId, fromBlock } = await createRequest('50000');

    // Décalage nul pendant le commit, puis 5 s d'avance : le service croit chaque échéance
    // passée alors que la chaîne, qui horodate ses blocs à l'heure réelle, la refuse encore.
    let skew = 0;
    const handle = start(v0Key, 'v0-t2', incidentsLog, {
      pollMs: 500,
      now: () => wallNow() + skew,
    });

    try {
      await waitUntil(
        () => handle.state.get(requestId)?.step === 'committed',
        20_000, 'étape committed (commit de v0)',
      );
      skew = 5;

      await waitUntil(
        async () => (await client().readContract({
          address: marketAddress, abi: marketAbi, functionName: 'getReveal', args: [requestId, v0.address],
        })).revealed,
        25_000, 'reveal effectif sur la chaîne après des tentatives annulées',
      );

      await waitUntil(
        async () => (await onChainStatus(requestId)) === STATUS.Closed,
        40_000, 'statut Closed : finalize puis close doivent être relancés après leurs annulations',
      );

      const mine = (await listTxs(rpcUrl, fromBlock)).filter(t => t.from === v0Addr);
      for (const step of ['reveal', 'finalize', 'close'] as const) {
        const ok = mine.filter(t => t.selector === SEL[step] && t.status === 'success');
        assert.equal(ok.length, 1, `${step} : une transaction réussie attendue. Vu : ${describeTxs(mine)}`);
      }
      const revertedReveals = mine.filter(t => t.selector === SEL.reveal && t.status === 'reverted');
      assert.ok(
        revertedReveals.length >= 1,
        `le scénario exige au moins un reveal annulé sur la chaîne avant le bon. Vu : ${describeTxs(mine)}`,
      );

      const finalized = await eventsFor('RequestFinalized', requestId);
      assert.equal((finalized[0].args as { code?: number }).code, 1, 'code 1 (HumanReview) attendu : un seul reveal');

      const onChain = await client().readContract({
        address: marketAddress, abi: marketAbi, functionName: 'getRequest', args: [requestId],
      });
      await waitUntil(
        () => handle.state.get(requestId)?.step === 'closed',
        10_000, 'étape closed dans l\'état de v0',
      );
      assert.equal(
        handle.state.get(requestId)?.contestDeadline, onChain.contestDeadline.toString(),
        'contestDeadline de l\'état : la valeur de la chaîne, jamais 0',
      );
      assert.deepEqual(incidentLines(incidentsLog), [], 'une annulation « trop tôt » n\'est pas un incident');
    } finally {
      handle.stop();
    }
  }, { timeout: 120_000 });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Commit manqué
  // ═══════════════════════════════════════════════════════════════════════════

  it('3. commit manqué : la demande rejoint finalize puis close', async () => {
    const incidentsLog = join(testRoot, 'incidents-3.log');
    const { requestId, commitDeadline, fromBlock } = await createRequest('50000');

    // Le service démarre après la fenêtre de commit.
    while (wallNow() < commitDeadline + 1) await sleep(250);
    const handle = start(v0Key, 'v0-t3', incidentsLog);

    try {
      await waitUntil(
        async () => (await onChainStatus(requestId)) === STATUS.Closed,
        45_000, 'statut Closed pour une demande dont le commit a été manqué',
      );

      const mine = (await listTxs(rpcUrl, fromBlock)).filter(t => t.from === v0Addr);
      assert.deepEqual(
        mine.filter(t => t.selector === SEL.commit || t.selector === SEL.reveal), [],
        `ni commit ni reveal après la fenêtre de commit. Vu : ${describeTxs(mine)}`,
      );

      const missed = (await eventsFor('VerifierMissed', requestId))
        .map(l => l.args as { verifier?: string; committed?: boolean })
        .find(a => a.verifier?.toLowerCase() === v0Addr);
      assert.ok(missed, 'VerifierMissed attendu pour v0');
      assert.equal(missed.committed, false, 'VerifierMissed.committed doit être false : v0 n\'a pas commité');

      await waitUntil(
        () => handle.state.get(requestId)?.step === 'closed',
        10_000, 'étape closed dans l\'état de v0',
      );
    } finally {
      handle.stop();
    }
  }, { timeout: 90_000 });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Erreur définitive
  // ═══════════════════════════════════════════════════════════════════════════

  it('4. CommitmentMismatch : un incident, aucune relance du reveal, la demande va jusqu\'à Closed', async () => {
    const incidentsLog = join(testRoot, 'incidents-4.log');
    const dataDir = 'v0-t4';
    const { requestId, fromBlock } = await createRequest('50000');

    const first = start(v0Key, dataDir, incidentsLog);
    await waitUntil(
      () => first.state.get(requestId)?.step === 'committed',
      20_000, 'étape committed (commit de v0)',
    );
    first.stop();
    await sleep(400); // laisse finir le tour en cours avant de toucher au fichier

    // Sel perdu : le reveal ne peut plus correspondre au commit inscrit.
    const statePath = join(testRoot, dataDir, 'state.json');
    const states = JSON.parse(readFileSync(statePath, 'utf8')) as { requestId: string; salt: string }[];
    const mineState = states.find(s => s.requestId === requestId.toString());
    assert.ok(mineState, 'état de la demande absent du fichier');
    mineState.salt = '0x' + randomBytes(32).toString('hex');
    writeFileSync(statePath, JSON.stringify(states, null, 2));

    const handle = start(v0Key, dataDir, incidentsLog);
    try {
      await waitUntil(
        () => incidentLines(incidentsLog).length >= 1,
        25_000, 'une ligne d\'incident pour le reveal en CommitmentMismatch',
      );
      await waitUntil(
        async () => (await onChainStatus(requestId)) === STATUS.Closed,
        45_000, 'statut Closed : la demande continue après une erreur définitive',
      );

      const lines = incidentLines(incidentsLog);
      assert.equal(lines.length, 1, `une seule ligne d'incident attendue. Vu : ${JSON.stringify(lines)}`);
      assert.equal(lines[0]['cause'], 'tx_reverted', 'cause de l\'incident');
      assert.equal(lines[0]['step'], 'reveal', 'étape de l\'incident');
      assert.equal(lines[0]['error'], 'CommitmentMismatch', 'nom d\'erreur décodé, pas une sous-chaîne du message');
      assert.equal(lines[0]['requestId'], requestId.toString(), 'requestId de l\'incident');

      const mine = (await listTxs(rpcUrl, fromBlock)).filter(t => t.from === v0Addr);
      const reveals = mine.filter(t => t.selector === SEL.reveal);
      assert.equal(
        reveals.length, 1,
        `une erreur définitive n'est pas retentée : un seul reveal envoyé attendu. Vu : ${describeTxs(mine)}`,
      );
      assert.equal(reveals[0].status, 'reverted', 'ce reveal doit être annulé sur la chaîne');

      const reveal = await client().readContract({
        address: marketAddress, abi: marketAbi, functionName: 'getReveal', args: [requestId, v0.address],
      });
      assert.equal(reveal.revealed, false, 'aucun reveal ne doit être inscrit');
    } finally {
      handle.stop();
    }
  }, { timeout: 120_000 });
});
