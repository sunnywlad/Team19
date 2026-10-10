// test/verifier.test.ts — tests d'intégration du service vérificateur
// Anvil + MockMarket + cache réel, 3 instances de vérificateur
//
// Scénarios :
//   1. Cycle complet (3 verifiers), jusqu'à Contest, 3 VerdictRevealed, codes par palier
//   2. Cache falsifié → vote 1, bit 7 (content_mismatch), incident écrit
//   3. Évaluateur échoue (STUB_EXIT) → bit 8 (evaluator_error)
//   4. Délai évaluateur (STUB_SLEEP_MS > timeout) → bit 9 (evaluator_timeout)
//   5. Motif inconnu dans la réponse du script → bit 8 (evaluator_error)
//   6. Reprise après redémarrage entre commit et reveal

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256 } from 'viem';
import type { Hex } from 'viem';

import {
  ANVIL_KEYS, CHAIN_ID, freePort, startAnvil, deployMockMarket,
  makePublicClient, makeWalletClient, advanceTime, makeBlockNow,
} from './helpers/chain.ts';
import { startCache } from '../cache/server.ts';
import { validatePayload, deriveFacts } from '../lib/payload.ts';
import { contentHashOf, hashOf } from '../lib/hash.ts';
import { marketAbi } from '../abi/market.ts';
import { postContent } from '../lib/cacheClient.ts';
import { startVerifier } from '../verifier/service.ts';
import type { VerifierHandle } from '../verifier/service.ts';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Palier du stub par amountMinor :
//   <= 100 000   → vote 2 (Accept), reasons []
//   <= 1 000 000 → vote 1 (HumanReview), reasons [insufficient_context] = bit 4
//   >  1 000 000 → vote 0 (Refuse), reasons [amount_above_cap] = bit 0

function makePayload(amountMinor: string, salt: string): Buffer {
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    requester: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    agentId: 'test-agent',
    prompt: 'Pay invoice',
    context: {},
    plannedDecision: {
      action: 'pay',
      amountMinor,
      currency: 'EUR',
      beneficiaryId: 'FR7612345987650123456789014',
      reference: 'INV-001',
    },
    createdAt: 1700000000,
    salt: '0x' + salt,
  }));
}

// Attend qu'une condition devienne vraie (polling court)
async function waitFor(
  cond: () => Promise<boolean> | boolean,
  timeoutMs = 30_000,
  intervalMs = 200,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('waitFor: timeout');
}

// Compte les VerdictRevealed pour une requestId donnée
async function countReveals(
  rpcUrl: string,
  marketAddress: Hex,
  requestId: bigint,
): Promise<number> {
  const client = makePublicClient(rpcUrl, CHAIN_ID);
  const logs = await client.getContractEvents({
    address: marketAddress,
    abi: marketAbi,
    eventName: 'VerdictRevealed',
    fromBlock: 0n,
  });
  return logs.filter(l => (l.args as { requestId?: bigint }).requestId === requestId).length;
}

// Transition Commit → Reveal via transitionToReveal du MockMarket
const transitionAbi = [{
  type: 'function', name: 'transitionToReveal',
  inputs: [{ name: 'requestId', type: 'uint256' }],
  outputs: [], stateMutability: 'nonpayable',
} as const];

// ─── Suite ───────────────────────────────────────────────────────────────────

// concurrency: false — les tests partagent un seul anvil et un seul cache ;
// ils doivent s'exécuter en série pour éviter les interférences d'état.
describe('verifier service — intégration', { concurrency: false }, () => {
  let anvilProc: Awaited<ReturnType<typeof startAnvil>>['proc'];
  let rpcUrl: string;
  let marketAddress: Hex;
  let cacheStop: () => Promise<void>;
  let cacheUrl: string;
  let cacheDataDir: string;
  let writeToken: string;
  let testRoot: string;

  // Comptes : 0=deployer, 1=v0, 2=v1, 3=v2, 4=requester
  const [deployerKey, v0Key, v1Key, v2Key] = ANVIL_KEYS;
  const v0 = privateKeyToAccount(v0Key);
  const v1 = privateKeyToAccount(v1Key);
  const v2 = privateKeyToAccount(v2Key);

  before(async () => {
    testRoot = join(tmpdir(), 'verifier-test-' + randomBytes(4).toString('hex'));
    mkdirSync(testRoot, { recursive: true });

    const anvilPort = await freePort();
    ({ proc: anvilProc, rpcUrl } = await startAnvil(anvilPort));

    // Fenêtres courtes : commit=6s, reveal=6s, contest=6s
    marketAddress = await deployMockMarket(
      rpcUrl, deployerKey, [v0.address, v1.address, v2.address],
      6, 6, 6,
    );

    cacheDataDir = join(testRoot, 'cache-data');
    mkdirSync(cacheDataDir, { recursive: true });
    writeToken = 'test-token-' + randomBytes(8).toString('hex');
    const cachePort = await freePort();
    cacheUrl = `http://127.0.0.1:${cachePort}`;

    const { stop } = await startCache({
      port: cachePort,
      dataDir: cacheDataDir,
      writeToken,
      rpcUrl,
      chainId: CHAIN_ID,
      marketAddress,
    });
    cacheStop = stop;
  }, { timeout: 60_000 });

  after(async () => {
    await cacheStop();
    anvilProc.kill();
    rmSync(testRoot, { recursive: true, force: true });
  });

  // ── Utilitaire : déposer un payload au cache et créer la demande sur la chaîne ──

  async function depositAndCreate(
    payloadBytes: Buffer,
  ): Promise<{ requestId: bigint; h: Hex; commitDeadline: number; revealDeadline: number }> {
    const parsed = validatePayload(payloadBytes);
    const facts = deriveFacts(parsed);
    const { h } = await postContent(cacheUrl, writeToken, payloadBytes, facts);

    const client = makePublicClient(rpcUrl, CHAIN_ID);
    const wallet = makeWalletClient(v0Key, rpcUrl, CHAIN_ID);
    const fee = await client.readContract({
      address: marketAddress, abi: marketAbi, functionName: 'requestFee',
    });

    const txHash = await wallet.writeContract({
      address: marketAddress, abi: marketAbi, functionName: 'createRequest',
      args: [h as Hex], value: fee as bigint,
    });
    await client.waitForTransactionReceipt({ hash: txHash });

    const logs = await client.getContractEvents({
      address: marketAddress, abi: marketAbi, eventName: 'RequestCreated', fromBlock: 0n,
    });
    const last = logs[logs.length - 1];
    const args = last.args as {
      requestId?: bigint; commitDeadline?: bigint; revealDeadline?: bigint;
    };
    return {
      requestId: args.requestId!,
      h: h as Hex,
      commitDeadline: Number(args.commitDeadline!),
      revealDeadline: Number(args.revealDeadline!),
    };
  }

  // ── Utilitaire : avancer le temps + déclencher transitionToReveal ──
  // Avance de assez de secondes pour dépasser commitDeadline + 2
  async function doTransitionToReveal(requestId: bigint, extraSeconds = 0): Promise<void> {
    // commitWindow=6, besoin de commitWindow + 3 = 9 secondes pour dépasser commitDeadline + 2
    await advanceTime(rpcUrl, 9 + extraSeconds);
    const wallet = makeWalletClient(deployerKey, rpcUrl, CHAIN_ID);
    const client = makePublicClient(rpcUrl, CHAIN_ID);
    await client.waitForTransactionReceipt({
      hash: await wallet.writeContract({
        address: marketAddress,
        abi: [...marketAbi, ...transitionAbi],
        functionName: 'transitionToReveal',
        args: [requestId],
      }),
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 1 : cycle complet — 3 verifiers, codes par palier
  // ═══════════════════════════════════════════════════════════════════════════

  describe('1. Cycle complet — 3 paliers du stub', () => {
    // Palier 1 : amountMinor=50000 → vote 2 (Accept) pour tous → code 2
    it('palier accept : vote 2 pour les 3, code 2 après Contest', async () => {
      const salt = randomBytes(32).toString('hex');
      const payloadBytes = makePayload('50000', salt);
      const { requestId } = await depositAndCreate(payloadBytes);

      const dataDir0 = join(testRoot, 'v0-test1a');
      const dataDir1 = join(testRoot, 'v1-test1a');
      const dataDir2 = join(testRoot, 'v2-test1a');

      const handles: VerifierHandle[] = [
        startVerifier({
          rpcUrl, chainId: CHAIN_ID, marketAddress, cacheUrl, verifierKey: v0Key,
          dataDir: dataDir0, pollMs: 200,
          now: makeBlockNow(rpcUrl),
          evaluatorCmd: 'node evaluator-stub/index.ts',
          incidentsLog: join(testRoot, 'incidents-1a.log'),
        }),
        startVerifier({
          rpcUrl, chainId: CHAIN_ID, marketAddress, cacheUrl, verifierKey: v1Key,
          dataDir: dataDir1, pollMs: 200,
          now: makeBlockNow(rpcUrl),
          evaluatorCmd: 'node evaluator-stub/index.ts',
          incidentsLog: join(testRoot, 'incidents-1a.log'),
        }),
        startVerifier({
          rpcUrl, chainId: CHAIN_ID, marketAddress, cacheUrl, verifierKey: v2Key,
          dataDir: dataDir2, pollMs: 200,
          now: makeBlockNow(rpcUrl),
          evaluatorCmd: 'node evaluator-stub/index.ts',
          incidentsLog: join(testRoot, 'incidents-1a.log'),
        }),
      ];

      try {
        // Attendre les 3 commits (avant commitDeadline)
        await waitFor(async () => {
          const client = makePublicClient(rpcUrl, CHAIN_ID);
          const logs = await client.getContractEvents({
            address: marketAddress, abi: marketAbi, eventName: 'VerdictCommitted', fromBlock: 0n,
          });
          const forThis = logs.filter(l => (l.args as { requestId?: bigint }).requestId === requestId);
          return forThis.length >= 3;
        }, 20_000);

        // Avancer le temps → commitDeadline dépassée
        await doTransitionToReveal(requestId);

        // Attendre les 3 reveals
        await waitFor(async () => (await countReveals(rpcUrl, marketAddress, requestId)) >= 3, 20_000);

        // Vérifier les votes : tous 2 (Accept), reasons 0
        const client = makePublicClient(rpcUrl, CHAIN_ID);
        for (const account of [v0, v1, v2]) {
          const reveal = await client.readContract({
            address: marketAddress, abi: marketAbi, functionName: 'getReveal',
            args: [requestId, account.address],
          });
          assert.equal(reveal.vote, 2, `vote de ${account.address} devrait être 2`);
          assert.equal(reveal.reasons, 0, `reasons de ${account.address} devrait être 0`);
        }

        // Attendre RequestFinalized (Contest)
        await waitFor(async () => {
          const logs = await client.getContractEvents({
            address: marketAddress, abi: marketAbi, eventName: 'RequestFinalized', fromBlock: 0n,
          });
          return logs.some(l => (l.args as { requestId?: bigint }).requestId === requestId);
        }, 15_000);

        const finLogs = await client.getContractEvents({
          address: marketAddress, abi: marketAbi, eventName: 'RequestFinalized', fromBlock: 0n,
        });
        const finLog = finLogs.find(l => (l.args as { requestId?: bigint }).requestId === requestId)!;
        assert.ok(finLog, 'RequestFinalized introuvable');
        // code 2 = Accept (tous ont voté 2)
        assert.equal((finLog.args as { code?: number }).code, 2, 'code devrait être 2 (Accept)');
      } finally {
        handles.forEach(h => h.stop());
      }
    }, { timeout: 60_000 });

    // Palier 2 : amountMinor=500000 → vote 1 (HumanReview), bit 4 → code 1
    it('palier human_review : vote 1 pour les 3, bit 4, code 1', async () => {
      const salt = randomBytes(32).toString('hex');
      const payloadBytes = makePayload('500000', salt);
      const { requestId } = await depositAndCreate(payloadBytes);

      const handles: VerifierHandle[] = [
        startVerifier({
          rpcUrl, chainId: CHAIN_ID, marketAddress, cacheUrl, verifierKey: v0Key,
          dataDir: join(testRoot, 'v0-test1b'), pollMs: 200,
          now: makeBlockNow(rpcUrl),
          evaluatorCmd: 'node evaluator-stub/index.ts',
          incidentsLog: join(testRoot, 'incidents-1b.log'),
        }),
        startVerifier({
          rpcUrl, chainId: CHAIN_ID, marketAddress, cacheUrl, verifierKey: v1Key,
          dataDir: join(testRoot, 'v1-test1b'), pollMs: 200,
          now: makeBlockNow(rpcUrl),
          evaluatorCmd: 'node evaluator-stub/index.ts',
          incidentsLog: join(testRoot, 'incidents-1b.log'),
        }),
        startVerifier({
          rpcUrl, chainId: CHAIN_ID, marketAddress, cacheUrl, verifierKey: v2Key,
          dataDir: join(testRoot, 'v2-test1b'), pollMs: 200,
          now: makeBlockNow(rpcUrl),
          evaluatorCmd: 'node evaluator-stub/index.ts',
          incidentsLog: join(testRoot, 'incidents-1b.log'),
        }),
      ];

      try {
        await waitFor(async () => {
          const client = makePublicClient(rpcUrl, CHAIN_ID);
          const logs = await client.getContractEvents({
            address: marketAddress, abi: marketAbi, eventName: 'VerdictCommitted', fromBlock: 0n,
          });
          return logs.filter(l => (l.args as { requestId?: bigint }).requestId === requestId).length >= 3;
        }, 20_000);

        await doTransitionToReveal(requestId);

        await waitFor(async () => (await countReveals(rpcUrl, marketAddress, requestId)) >= 3, 20_000);

        const client = makePublicClient(rpcUrl, CHAIN_ID);
        for (const account of [v0, v1, v2]) {
          const reveal = await client.readContract({
            address: marketAddress, abi: marketAbi, functionName: 'getReveal',
            args: [requestId, account.address],
          });
          assert.equal(reveal.vote, 1, `vote de ${account.address} devrait être 1`);
          // bit 4 = insufficient_context
          assert.equal(reveal.reasons & (1 << 4), 1 << 4, 'bit 4 (insufficient_context) attendu');
        }

        await waitFor(async () => {
          const logs = await client.getContractEvents({
            address: marketAddress, abi: marketAbi, eventName: 'RequestFinalized', fromBlock: 0n,
          });
          return logs.some(l => (l.args as { requestId?: bigint }).requestId === requestId);
        }, 15_000);

        const finLogs = await client.getContractEvents({
          address: marketAddress, abi: marketAbi, eventName: 'RequestFinalized', fromBlock: 0n,
        });
        const finLog = finLogs.find(l => (l.args as { requestId?: bigint }).requestId === requestId)!;
        // code 1 = HumanReview
        assert.equal((finLog.args as { code?: number }).code, 1, 'code devrait être 1 (HumanReview)');
      } finally {
        handles.forEach(h => h.stop());
      }
    }, { timeout: 60_000 });

    // Palier 3 : amountMinor=5000000 → vote 0 (Refuse), bit 0 → code 0
    it('palier refuse : vote 0 pour les 3, bit 0, code 0', async () => {
      const salt = randomBytes(32).toString('hex');
      const payloadBytes = makePayload('5000000', salt);
      const { requestId } = await depositAndCreate(payloadBytes);

      const handles: VerifierHandle[] = [
        startVerifier({
          rpcUrl, chainId: CHAIN_ID, marketAddress, cacheUrl, verifierKey: v0Key,
          dataDir: join(testRoot, 'v0-test1c'), pollMs: 200,
          now: makeBlockNow(rpcUrl),
          evaluatorCmd: 'node evaluator-stub/index.ts',
          incidentsLog: join(testRoot, 'incidents-1c.log'),
        }),
        startVerifier({
          rpcUrl, chainId: CHAIN_ID, marketAddress, cacheUrl, verifierKey: v1Key,
          dataDir: join(testRoot, 'v1-test1c'), pollMs: 200,
          now: makeBlockNow(rpcUrl),
          evaluatorCmd: 'node evaluator-stub/index.ts',
          incidentsLog: join(testRoot, 'incidents-1c.log'),
        }),
        startVerifier({
          rpcUrl, chainId: CHAIN_ID, marketAddress, cacheUrl, verifierKey: v2Key,
          dataDir: join(testRoot, 'v2-test1c'), pollMs: 200,
          now: makeBlockNow(rpcUrl),
          evaluatorCmd: 'node evaluator-stub/index.ts',
          incidentsLog: join(testRoot, 'incidents-1c.log'),
        }),
      ];

      try {
        await waitFor(async () => {
          const client = makePublicClient(rpcUrl, CHAIN_ID);
          const logs = await client.getContractEvents({
            address: marketAddress, abi: marketAbi, eventName: 'VerdictCommitted', fromBlock: 0n,
          });
          return logs.filter(l => (l.args as { requestId?: bigint }).requestId === requestId).length >= 3;
        }, 20_000);

        await doTransitionToReveal(requestId);

        await waitFor(async () => (await countReveals(rpcUrl, marketAddress, requestId)) >= 3, 20_000);

        const client = makePublicClient(rpcUrl, CHAIN_ID);
        for (const account of [v0, v1, v2]) {
          const reveal = await client.readContract({
            address: marketAddress, abi: marketAbi, functionName: 'getReveal',
            args: [requestId, account.address],
          });
          assert.equal(reveal.vote, 0, `vote de ${account.address} devrait être 0`);
          // bit 0 = amount_above_cap
          assert.equal(reveal.reasons & 1, 1, 'bit 0 (amount_above_cap) attendu');
        }

        await waitFor(async () => {
          const logs = await client.getContractEvents({
            address: marketAddress, abi: marketAbi, eventName: 'RequestFinalized', fromBlock: 0n,
          });
          return logs.some(l => (l.args as { requestId?: bigint }).requestId === requestId);
        }, 15_000);

        const finLogs = await client.getContractEvents({
          address: marketAddress, abi: marketAbi, eventName: 'RequestFinalized', fromBlock: 0n,
        });
        const finLog = finLogs.find(l => (l.args as { requestId?: bigint }).requestId === requestId)!;
        // code 0 = Refuse
        assert.equal((finLog.args as { code?: number }).code, 0, 'code devrait être 0 (Refuse)');
      } finally {
        handles.forEach(h => h.stop());
      }
    }, { timeout: 60_000 });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 2 : cache falsifié → vote 1, bit 7, incident
  // ═══════════════════════════════════════════════════════════════════════════

  it('2. Cache falsifié → vote 1, bit 7 (content_mismatch), incident écrit', async () => {
    const salt = randomBytes(32).toString('hex');
    const payloadBytes = makePayload('50000', salt);
    const parsed = validatePayload(payloadBytes);
    const facts = deriveFacts(parsed);
    const { h } = await postContent(cacheUrl, writeToken, payloadBytes, facts);

    // Corrompre le fichier .bin du cache (remplacer par du contenu différent)
    const contentHash = contentHashOf(payloadBytes);
    const binPath = join(cacheDataDir, 'content', `${h}.bin`);
    // Attendre que le cache ait écrit le fichier
    await waitFor(() => existsSync(binPath), 5_000);

    // Modifier le payload dans le cache : changer amountMinor sans recalculer h
    const corruptPayload = { ...JSON.parse(payloadBytes.toString()), plannedDecision: { ...parsed.plannedDecision, amountMinor: '9999999' } };
    writeFileSync(binPath, Buffer.from(JSON.stringify(corruptPayload)));

    // Créer la demande sur la chaîne
    const client = makePublicClient(rpcUrl, CHAIN_ID);
    const wallet = makeWalletClient(v0Key, rpcUrl, CHAIN_ID);
    const fee = await client.readContract({ address: marketAddress, abi: marketAbi, functionName: 'requestFee' });
    const txHash = await wallet.writeContract({
      address: marketAddress, abi: marketAbi, functionName: 'createRequest',
      args: [h as Hex], value: fee as bigint,
    });
    await client.waitForTransactionReceipt({ hash: txHash });
    const logs = await client.getContractEvents({
      address: marketAddress, abi: marketAbi, eventName: 'RequestCreated', fromBlock: 0n,
    });
    const requestId = (logs[logs.length - 1].args as { requestId?: bigint }).requestId!;

    const incidentsLog = join(testRoot, 'incidents-2.log');

    // Un seul vérificateur suffit (v0)
    const handle = startVerifier({
      rpcUrl, chainId: CHAIN_ID, marketAddress, cacheUrl, verifierKey: v0Key,
      dataDir: join(testRoot, 'v0-test2'), pollMs: 200,
      now: makeBlockNow(rpcUrl),
      evaluatorCmd: 'node evaluator-stub/index.ts',
      incidentsLog,
    });

    try {
      // Attendre le commit
      await waitFor(async () => {
        const commitLogs = await client.getContractEvents({
          address: marketAddress, abi: marketAbi, eventName: 'VerdictCommitted', fromBlock: 0n,
        });
        return commitLogs.some(l => (l.args as { requestId?: bigint }).requestId === requestId);
      }, 20_000);

      // Avancer le temps pour déclencher la révélation
      await doTransitionToReveal(requestId);

      await waitFor(async () => (await countReveals(rpcUrl, marketAddress, requestId)) >= 1, 20_000);

      // Vérifier que le vote est 1 et le bit 7 est levé
      const reveal = await client.readContract({
        address: marketAddress, abi: marketAbi, functionName: 'getReveal',
        args: [requestId, v0.address],
      });
      assert.equal(reveal.vote, 1, 'vote devrait être 1 (content_mismatch)');
      assert.equal(reveal.reasons & (1 << 7), 1 << 7, 'bit 7 (content_mismatch) attendu');

      // Vérifier l'incident
      assert.ok(existsSync(incidentsLog), 'fichier incidents absent');
      const incidentContent = readFileSync(incidentsLog, 'utf8');
      assert.ok(incidentContent.includes('content_mismatch'), 'cause content_mismatch absente de l\'incident');
    } finally {
      handle.stop();
    }
  }, { timeout: 60_000 });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 3 : évaluateur échoue (STUB_EXIT) → bit 8
  // ═══════════════════════════════════════════════════════════════════════════

  it('3. Évaluateur échoue (STUB_EXIT=1) → vote 1, bit 8 (evaluator_error)', async () => {
    const salt = randomBytes(32).toString('hex');
    const payloadBytes = makePayload('50000', salt);
    const { requestId } = await depositAndCreate(payloadBytes);

    const client = makePublicClient(rpcUrl, CHAIN_ID);

    const handle = startVerifier({
      rpcUrl, chainId: CHAIN_ID, marketAddress, cacheUrl, verifierKey: v0Key,
      dataDir: join(testRoot, 'v0-test3'), pollMs: 200,
      now: makeBlockNow(rpcUrl),
      // STUB_EXIT=1 force un code de sortie non nul
      evaluatorCmd: 'STUB_EXIT=1 node evaluator-stub/index.ts',
      incidentsLog: join(testRoot, 'incidents-3.log'),
    });

    try {
      await waitFor(async () => {
        const logs = await client.getContractEvents({
          address: marketAddress, abi: marketAbi, eventName: 'VerdictCommitted', fromBlock: 0n,
        });
        return logs.some(l => (l.args as { requestId?: bigint }).requestId === requestId);
      }, 20_000);

      await doTransitionToReveal(requestId);

      await waitFor(async () => (await countReveals(rpcUrl, marketAddress, requestId)) >= 1, 20_000);

      const reveal = await client.readContract({
        address: marketAddress, abi: marketAbi, functionName: 'getReveal',
        args: [requestId, v0.address],
      });
      assert.equal(reveal.vote, 1, 'vote devrait être 1 (evaluator_error)');
      assert.equal(reveal.reasons & (1 << 8), 1 << 8, 'bit 8 (evaluator_error) attendu');
    } finally {
      handle.stop();
    }
  }, { timeout: 60_000 });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 4 : délai évaluateur → bit 9
  // ═══════════════════════════════════════════════════════════════════════════

  it('4. Délai évaluateur (STUB_SLEEP > TIMEOUT) → vote 1, bit 9 (evaluator_timeout)', async () => {
    const salt = randomBytes(32).toString('hex');
    const payloadBytes = makePayload('50000', salt);
    const { requestId } = await depositAndCreate(payloadBytes);

    const client = makePublicClient(rpcUrl, CHAIN_ID);

    // EVALUATOR_TIMEOUT_MS court (300ms), STUB_SLEEP_MS long (2000ms)
    const handle = startVerifier({
      rpcUrl, chainId: CHAIN_ID, marketAddress, cacheUrl, verifierKey: v0Key,
      dataDir: join(testRoot, 'v0-test4'), pollMs: 200,
      now: makeBlockNow(rpcUrl),
      evaluatorCmd: 'STUB_SLEEP_MS=2000 node evaluator-stub/index.ts',
      evaluatorTimeoutMs: 300,
      incidentsLog: join(testRoot, 'incidents-4.log'),
    });

    try {
      await waitFor(async () => {
        const logs = await client.getContractEvents({
          address: marketAddress, abi: marketAbi, eventName: 'VerdictCommitted', fromBlock: 0n,
        });
        return logs.some(l => (l.args as { requestId?: bigint }).requestId === requestId);
      }, 20_000);

      await doTransitionToReveal(requestId);

      await waitFor(async () => (await countReveals(rpcUrl, marketAddress, requestId)) >= 1, 20_000);

      const reveal = await client.readContract({
        address: marketAddress, abi: marketAbi, functionName: 'getReveal',
        args: [requestId, v0.address],
      });
      assert.equal(reveal.vote, 1, 'vote devrait être 1 (evaluator_timeout)');
      assert.equal(reveal.reasons & (1 << 9), 1 << 9, 'bit 9 (evaluator_timeout) attendu');
    } finally {
      handle.stop();
    }
  }, { timeout: 60_000 });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 5 : motif inconnu dans la réponse → bit 8
  // ═══════════════════════════════════════════════════════════════════════════

  it('5. Motif inconnu dans stdout de l\'évaluateur → vote 1, bit 8 (evaluator_error)', async () => {
    const salt = randomBytes(32).toString('hex');
    const payloadBytes = makePayload('50000', salt);
    const { requestId } = await depositAndCreate(payloadBytes);

    const client = makePublicClient(rpcUrl, CHAIN_ID);

    // Commande shell qui émet un motif inconnu
    const badEvaluatorCmd = `node -e "process.stdout.write(JSON.stringify({vote:1,reasons:['unknown_reason_xyz'],summary:'test'})+'\\n')"`;

    const handle = startVerifier({
      rpcUrl, chainId: CHAIN_ID, marketAddress, cacheUrl, verifierKey: v0Key,
      dataDir: join(testRoot, 'v0-test5'), pollMs: 200,
      now: makeBlockNow(rpcUrl),
      evaluatorCmd: badEvaluatorCmd,
      incidentsLog: join(testRoot, 'incidents-5.log'),
    });

    try {
      await waitFor(async () => {
        const logs = await client.getContractEvents({
          address: marketAddress, abi: marketAbi, eventName: 'VerdictCommitted', fromBlock: 0n,
        });
        return logs.some(l => (l.args as { requestId?: bigint }).requestId === requestId);
      }, 20_000);

      await doTransitionToReveal(requestId);

      await waitFor(async () => (await countReveals(rpcUrl, marketAddress, requestId)) >= 1, 20_000);

      const reveal = await client.readContract({
        address: marketAddress, abi: marketAbi, functionName: 'getReveal',
        args: [requestId, v0.address],
      });
      assert.equal(reveal.vote, 1, 'vote devrait être 1 (evaluator_error)');
      assert.equal(reveal.reasons & (1 << 8), 1 << 8, 'bit 8 (evaluator_error) attendu');
    } finally {
      handle.stop();
    }
  }, { timeout: 60_000 });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 6 : reprise après redémarrage entre commit et reveal
  // ═══════════════════════════════════════════════════════════════════════════

  it('6. Reprise après redémarrage entre commit et reveal', async () => {
    const salt = randomBytes(32).toString('hex');
    const payloadBytes = makePayload('50000', salt);
    const { requestId } = await depositAndCreate(payloadBytes);

    const client = makePublicClient(rpcUrl, CHAIN_ID);
    const dataDir = join(testRoot, 'v0-test6');

    // Phase 1 : démarrer, attendre le commit, arrêter
    const handle1 = startVerifier({
      rpcUrl, chainId: CHAIN_ID, marketAddress, cacheUrl, verifierKey: v0Key,
      dataDir, pollMs: 200,
      now: makeBlockNow(rpcUrl),
      evaluatorCmd: 'node evaluator-stub/index.ts',
      incidentsLog: join(testRoot, 'incidents-6.log'),
    });

    await waitFor(async () => {
      const logs = await client.getContractEvents({
        address: marketAddress, abi: marketAbi, eventName: 'VerdictCommitted', fromBlock: 0n,
      });
      return logs.some(l => (l.args as { requestId?: bigint }).requestId === requestId);
    }, 20_000);

    // Arrêter AVANT d'avancer le temps (avant la fenêtre de reveal)
    handle1.stop();

    // Avancer le temps → commitDeadline dépassée
    await doTransitionToReveal(requestId);

    // Phase 2 : redémarrer avec le MÊME dataDir (même sel sur disque)
    const handle2 = startVerifier({
      rpcUrl, chainId: CHAIN_ID, marketAddress, cacheUrl, verifierKey: v0Key,
      dataDir, pollMs: 200,
      now: makeBlockNow(rpcUrl),
      evaluatorCmd: 'node evaluator-stub/index.ts',
      incidentsLog: join(testRoot, 'incidents-6.log'),
    });

    try {
      // Le reveal doit réussir depuis l'état persisté
      await waitFor(async () => (await countReveals(rpcUrl, marketAddress, requestId)) >= 1, 20_000);

      const reveal = await client.readContract({
        address: marketAddress, abi: marketAbi, functionName: 'getReveal',
        args: [requestId, v0.address],
      });
      assert.ok(reveal.revealed, 'reveal devrait être vrai après reprise');
      // vote 2 (accept, amountMinor=50000)
      assert.equal(reveal.vote, 2, 'vote devrait être 2 après reprise');
    } finally {
      handle2.stop();
    }
  }, { timeout: 60_000 });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 8 : non-régression — revealVerdict est tenté dès que nowFn > commitDeadline + 3,
  // sans attendre un statut Reveal rendu par eth_call.
  // Scénario : nowFn retourne l'heure murale (déjà passée), EVM en retard.
  // Le vérificateur tente reveal → WrongPhase (bloc en retard) → réessaie.
  // Puis on avance l'EVM et on appelle transitionToReveal → le reveal passe.
  // ═══════════════════════════════════════════════════════════════════════════

  it('8. Révèle dès que nowFn > commitDeadline + 3 sans attendre statut Reveal on-chain', async () => {
    const salt = randomBytes(32).toString('hex');
    const payloadBytes = makePayload('50000', salt);
    const { requestId, commitDeadline: cd } = await depositAndCreate(payloadBytes);

    const client = makePublicClient(rpcUrl, CHAIN_ID);

    // nowFn commutable : EVM time pendant la fenêtre de commit (pour que le commit passe),
    // puis horloge murale avancée (commitDeadline + 4) une fois le commit fait.
    // Cela simule le cas réel où l'horloge murale dépasse block.timestamp d'un L1 inactif.
    let useWallClock = false;
    const blockNow = makeBlockNow(rpcUrl);
    const nowFn = async () => {
      if (useWallClock) return cd + 4; // wall clock avancée : > commitDeadline + 3, < revealDeadline (= cd+6)
      return blockNow();               // EVM time pendant le commit
    };

    const dataDir = join(testRoot, 'v0-test8');
    const handle = startVerifier({
      rpcUrl, chainId: CHAIN_ID, marketAddress, cacheUrl, verifierKey: v0Key,
      dataDir, pollMs: 200,
      now: nowFn,
      evaluatorCmd: 'node evaluator-stub/index.ts',
      incidentsLog: join(testRoot, 'incidents-8.log'),
    });

    try {
      // Attendre le commit (avec EVM time, la fenêtre de commit est respectée)
      await waitFor(async () => {
        const logs = await client.getContractEvents({
          address: marketAddress, abi: marketAbi, eventName: 'VerdictCommitted', fromBlock: 0n,
        });
        return logs.some(l => (l.args as { requestId?: bigint }).requestId === requestId);
      }, 20_000);

      // Basculer sur l'horloge murale avancée : le vérificateur voit now > commitDeadline + 3
      // mais le bloc EVM est encore en retard → revealVerdict revert WrongPhase.
      useWallClock = true;

      // Attendre un peu que le service tente reveal et reçoive WrongPhase (log attendu)
      await new Promise(r => setTimeout(r, 1_000));

      // Avancer l'EVM et appeler transitionToReveal → le reveal peut maintenant passer
      await doTransitionToReveal(requestId);

      // Le reveal doit réussir maintenant
      await waitFor(async () => (await countReveals(rpcUrl, marketAddress, requestId)) >= 1, 20_000);

      const reveal = await client.readContract({
        address: marketAddress, abi: marketAbi, functionName: 'getReveal',
        args: [requestId, v0.address],
      });
      assert.ok(reveal.revealed, 'Le reveal doit être effectif');
      assert.equal(reveal.vote, 2, 'vote 2 attendu (accept, amountMinor=50000)');
    } finally {
      handle.stop();
    }
  }, { timeout: 60_000 });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 7 : isolation de l'environnement de l'évaluateur
  // L'évaluateur tiers ne doit jamais recevoir VERIFIER_KEY, *_KEY,
  // CACHE_WRITE_TOKEN ni GATEWAY_API_KEYS.
  // ═══════════════════════════════════════════════════════════════════════════

  it('7. L\'évaluateur ne reçoit pas VERIFIER_KEY ni aucune *_KEY', async () => {
    const salt = randomBytes(32).toString('hex');
    const payloadBytes = makePayload('50000', salt);
    const { requestId } = await depositAndCreate(payloadBytes);

    const client = makePublicClient(rpcUrl, CHAIN_ID);

    // Fichier temporaire dans lequel le script d'évaluation écrit son env
    const envDumpFile = join(testRoot, 'eval-env-dump-7.txt');

    // Injecter des variables sensibles dans le process courant (simuler la prod)
    const fakeKey = '0x' + 'ab'.repeat(32);
    process.env['VERIFIER_KEY']      = fakeKey;
    process.env['REQUESTER_KEY']     = fakeKey;
    process.env['CACHE_WRITE_TOKEN'] = 'super-secret-token';
    process.env['GATEWAY_API_KEYS']  = 'gw-key-1:gw-key-2';
    process.env['SOME_OTHER_KEY']    = 'other-secret';

    // Écrire le script de dump dans un fichier .mjs (ESM, compatible avec node --experimental-strip-types)
    const dumpScriptPath = join(testRoot, 'eval-dump-7.mjs');
    const dumpScriptContent = [
      'import { writeFileSync } from "node:fs";',
      `writeFileSync(${JSON.stringify(envDumpFile)}, JSON.stringify(process.env));`,
      'process.stdout.write(JSON.stringify({vote:2,reasons:[],summary:"ok"})+"\\n");',
    ].join('\n');
    writeFileSync(dumpScriptPath, dumpScriptContent);

    const dumpCmd = `node ${JSON.stringify(dumpScriptPath)}`;

    const handle = startVerifier({
      rpcUrl, chainId: CHAIN_ID, marketAddress, cacheUrl, verifierKey: v0Key,
      dataDir: join(testRoot, 'v0-test7'), pollMs: 200,
      now: makeBlockNow(rpcUrl),
      evaluatorCmd: dumpCmd,
      incidentsLog: join(testRoot, 'incidents-7.log'),
    });

    try {
      // Attendre que le vérificateur committe (le script aura été appelé)
      await waitFor(async () => {
        const logs = await client.getContractEvents({
          address: marketAddress, abi: marketAbi, eventName: 'VerdictCommitted', fromBlock: 0n,
        });
        return logs.some(l => (l.args as { requestId?: bigint }).requestId === requestId);
      }, 20_000);

      // Lire l'env reçu par le script
      assert.ok(existsSync(envDumpFile), 'le script d\'évaluation n\'a pas écrit son env');
      const receivedEnv = JSON.parse(readFileSync(envDumpFile, 'utf8')) as Record<string, string>;

      // Aucune variable *_KEY ne doit figurer dans l'env reçu
      const sensitiveVarNames = Object.keys(receivedEnv).filter(k =>
        k.toUpperCase().endsWith('_KEY'),
      );
      assert.deepEqual(
        sensitiveVarNames, [],
        `L'évaluateur a reçu des variables *_KEY : ${sensitiveVarNames.join(', ')}`,
      );

      // La valeur de VERIFIER_KEY ne doit pas apparaître dans l'env reçu
      const envStr = JSON.stringify(receivedEnv);
      assert.ok(
        !envStr.includes(fakeKey),
        'La valeur de VERIFIER_KEY est présente dans l\'env reçu par l\'évaluateur',
      );

      // CACHE_WRITE_TOKEN et GATEWAY_API_KEYS ne doivent pas figurer
      assert.ok(!('CACHE_WRITE_TOKEN' in receivedEnv), 'CACHE_WRITE_TOKEN transmis à l\'évaluateur');
      assert.ok(!('GATEWAY_API_KEYS' in receivedEnv), 'GATEWAY_API_KEYS transmis à l\'évaluateur');
    } finally {
      handle.stop();
      // Nettoyer les variables sensibles injectées pour les tests suivants
      delete process.env['VERIFIER_KEY'];
      delete process.env['REQUESTER_KEY'];
      delete process.env['CACHE_WRITE_TOKEN'];
      delete process.env['GATEWAY_API_KEYS'];
      delete process.env['SOME_OTHER_KEY'];
    }
  }, { timeout: 30_000 });
});
