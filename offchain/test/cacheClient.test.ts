// test/cacheClient.test.ts — tests d'intégration de lib/cacheClient.ts
// Lance le serveur de cache sur un port libre, puis vérifie chaque fonction du client.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

import {
  ANVIL_KEYS, CHAIN_ID, freePort, startAnvil, deployMockMarket,
  makePublicClient, makeWalletClient, advanceTime,
} from './helpers/chain.ts';
import { startCache } from '../cache/server.ts';
import { validatePayload, deriveFacts } from '../lib/payload.ts';
import { contentHashOf, hashOf, commitmentOf } from '../lib/hash.ts';
import { marketAbi } from '../abi/market.ts';
import {
  postContent, getContent, postDetail, getDetail, CacheClientError,
} from '../lib/cacheClient.ts';

// ─── Fixture payload ──────────────────────────────────────────────────────────

const PAYLOAD_OBJ = {
  schemaVersion: 1,
  requester: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
  agentId: 'client-test-agent',
  prompt: 'Pay INV-042',
  context: {},
  plannedDecision: {
    action: 'pay',
    amountMinor: '75000',
    currency: 'EUR',
    beneficiaryId: 'FR7612345987650123456789014',
    reference: 'INV-042',
  },
  createdAt: 1700000000,
  salt: '0x' + 'cd'.repeat(32),
};

describe('cacheClient — intégration', () => {
  let anvilProc: Awaited<ReturnType<typeof startAnvil>>['proc'];
  let rpcUrl: string;
  let marketAddress: Hex;
  let cacheStop: () => Promise<void>;
  let cacheUrl: string;
  let dataDir: string;
  let writeToken: string;

  const [deployerKey, v0Key, v1Key, v2Key, requesterKey] = ANVIL_KEYS;
  const v0 = privateKeyToAccount(v0Key);
  const v1 = privateKeyToAccount(v1Key);
  const v2 = privateKeyToAccount(v2Key);
  const requesterAccount = privateKeyToAccount(requesterKey);

  before(async () => {
    // Anvil
    const anvilPort = await freePort();
    ({ proc: anvilProc, rpcUrl } = await startAnvil(anvilPort));

    // MockMarket (fenêtres très courtes)
    marketAddress = await deployMockMarket(
      rpcUrl, deployerKey, [v0.address, v1.address, v2.address],
      3, 3, 600,
    );

    // Cache
    dataDir = join(tmpdir(), 'cacheClient-test-' + randomBytes(4).toString('hex'));
    mkdirSync(dataDir, { recursive: true });
    writeToken = 'test-token-' + randomBytes(8).toString('hex');
    const cachePort = await freePort();
    cacheUrl = `http://127.0.0.1:${cachePort}`;

    const { stop } = await startCache({
      port: cachePort,
      dataDir,
      writeToken,
      rpcUrl,
      chainId: CHAIN_ID,
      marketAddress,
    });
    cacheStop = stop;
  }, { timeout: 30_000 });

  after(async () => {
    await cacheStop();
    anvilProc.kill();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('postContent : stocke le payload et renvoie contentHash et h', async () => {
    const payloadBytes = Buffer.from(JSON.stringify(PAYLOAD_OBJ));
    const parsed = validatePayload(payloadBytes);
    const facts = deriveFacts(parsed);

    const result = await postContent(cacheUrl, writeToken, payloadBytes, facts);

    const expectedContentHash = contentHashOf(payloadBytes);
    const expectedH = hashOf(facts, expectedContentHash);

    assert.equal(result.contentHash.toLowerCase(), expectedContentHash.toLowerCase());
    assert.equal(result.h.toLowerCase(), expectedH.toLowerCase());
  });

  it('postContent : idempotent (deux appels → même résultat)', async () => {
    const payloadBytes = Buffer.from(JSON.stringify(PAYLOAD_OBJ));
    const parsed = validatePayload(payloadBytes);
    const facts = deriveFacts(parsed);

    const r1 = await postContent(cacheUrl, writeToken, payloadBytes, facts);
    const r2 = await postContent(cacheUrl, writeToken, payloadBytes, facts);

    assert.equal(r1.h, r2.h);
    assert.equal(r1.contentHash, r2.contentHash);
  });

  it('postContent : token invalide → CacheClientError 401', async () => {
    const payloadBytes = Buffer.from(JSON.stringify(PAYLOAD_OBJ));
    const parsed = validatePayload(payloadBytes);
    const facts = deriveFacts(parsed);

    await assert.rejects(
      () => postContent(cacheUrl, 'mauvais-token', payloadBytes, facts),
      (err) => err instanceof CacheClientError && err.status === 401,
    );
  });

  it('getContent : lit le payload depuis la chaîne avec une demande active', async () => {
    // Déposer au cache
    const payloadBytes = Buffer.from(JSON.stringify(PAYLOAD_OBJ));
    const parsed = validatePayload(payloadBytes);
    const facts = deriveFacts(parsed);
    const { h } = await postContent(cacheUrl, writeToken, payloadBytes, facts);

    // Créer la demande sur la chaîne avec l'adresse du requester comme signataire
    // On utilise v0 comme requester ici pour simplifier (il est dans le comité)
    const client = makePublicClient(rpcUrl, CHAIN_ID);
    const wallet = makeWalletClient(v0Key, rpcUrl, CHAIN_ID);
    const fee = await client.readContract({ address: marketAddress, abi: marketAbi, functionName: 'requestFee' });

    const txHash = await wallet.writeContract({
      address: marketAddress,
      abi: marketAbi,
      functionName: 'createRequest',
      args: [h as Hex],
      value: fee as bigint,
    });
    await client.waitForTransactionReceipt({ hash: txHash });

    // Récupérer le requestId
    const logs = await client.getContractEvents({
      address: marketAddress,
      abi: marketAbi,
      eventName: 'RequestCreated',
      fromBlock: 0n,
    });
    const lastLog = logs[logs.length - 1];
    const requestId = (lastLog.args as { requestId?: bigint }).requestId!;

    // Lire depuis le cache en tant que membre du comité (v0)
    const result = await getContent(cacheUrl, v0, BigInt(CHAIN_ID), requestId, h as Hex);

    assert.ok(typeof result.payload === 'string', 'payload absent');
    const decoded = Buffer.from(result.payload, 'base64');
    assert.deepEqual(JSON.parse(decoded.toString('utf8')), PAYLOAD_OBJ);
  });

  it('postDetail + getDetail : dépôt et lecture du détail en statut Contest', async () => {
    // Stocker un payload différent pour éviter collision de h
    const payloadObj2 = { ...PAYLOAD_OBJ, salt: '0x' + 'ef'.repeat(32) };
    const payloadBytes = Buffer.from(JSON.stringify(payloadObj2));
    const parsed = validatePayload(payloadBytes);
    const facts = deriveFacts(parsed);
    const { h } = await postContent(cacheUrl, writeToken, payloadBytes, facts);

    const client = makePublicClient(rpcUrl, CHAIN_ID);
    const fee = await client.readContract({ address: marketAddress, abi: marketAbi, functionName: 'requestFee' });

    // v0 crée la demande (requester = v0)
    const walletV0 = makeWalletClient(v0Key, rpcUrl, CHAIN_ID);
    const tx0 = await walletV0.writeContract({
      address: marketAddress, abi: marketAbi, functionName: 'createRequest',
      args: [h as Hex], value: fee as bigint,
    });
    await client.waitForTransactionReceipt({ hash: tx0 });

    const logs = await client.getContractEvents({
      address: marketAddress, abi: marketAbi, eventName: 'RequestCreated', fromBlock: 0n,
    });
    const requestId = (logs[logs.length - 1].args as { requestId?: bigint }).requestId!;

    // Commits d'abord (avant d'avancer le temps)
    const commitSalt0 = ('0x' + randomBytes(32).toString('hex')) as Hex;
    const detail0 = Buffer.from(JSON.stringify({ vote: 2, reasons: [], summary: 'ok' }));
    const { keccak256: k256 } = await import('viem');
    const detailHash0 = k256(new Uint8Array(detail0));

    const commitment0 = commitmentOf({
      chainId: BigInt(CHAIN_ID), market: marketAddress, requestId,
      verifier: v0.address, vote: 2, reasons: 0, detailHash: detailHash0, salt: commitSalt0,
    });

    await client.waitForTransactionReceipt({
      hash: await walletV0.writeContract({
        address: marketAddress, abi: marketAbi, functionName: 'commitVerdict',
        args: [requestId, commitment0],
      }),
    });

    const salts: Hex[] = [commitSalt0];
    const details: Buffer[] = [detail0];
    const detailHashes: Hex[] = [detailHash0];

    for (const [key, account] of [[v1Key, v1], [v2Key, v2]] as [Hex, typeof v0][]) {
      const salt = ('0x' + randomBytes(32).toString('hex')) as Hex;
      const detail = Buffer.from(JSON.stringify({ vote: 2, reasons: [], summary: 'ok' }));
      const detailHash = k256(new Uint8Array(detail));
      const commitment = commitmentOf({
        chainId: BigInt(CHAIN_ID), market: marketAddress, requestId,
        verifier: account.address, vote: 2, reasons: 0, detailHash, salt,
      });
      const wlt = makeWalletClient(key, rpcUrl, CHAIN_ID);
      await client.waitForTransactionReceipt({
        hash: await wlt.writeContract({
          address: marketAddress, abi: marketAbi, functionName: 'commitVerdict',
          args: [requestId, commitment],
        }),
      });
      salts.push(salt);
      details.push(detail);
      detailHashes.push(detailHash);
    }

    // Avancer après commitDeadline pour passer en Reveal
    await advanceTime(rpcUrl, 4);

    // MockMarket nécessite une transition explicite Commit → Reveal
    const walletTr = makeWalletClient(deployerKey, rpcUrl, CHAIN_ID);
    await client.waitForTransactionReceipt({
      hash: await walletTr.writeContract({
        address: marketAddress,
        abi: [...marketAbi, {
          type: 'function', name: 'transitionToReveal',
          inputs: [{ name: 'requestId', type: 'uint256' }],
          outputs: [], stateMutability: 'nonpayable',
        } as const],
        functionName: 'transitionToReveal',
        args: [requestId],
      }),
    });

    // Reveals
    const verifiers = [v0, v1, v2];
    const keys = [v0Key, v1Key, v2Key];
    for (let i = 0; i < 3; i++) {
      const wlt = makeWalletClient(keys[i], rpcUrl, CHAIN_ID);
      await client.waitForTransactionReceipt({
        hash: await wlt.writeContract({
          address: marketAddress, abi: marketAbi, functionName: 'revealVerdict',
          args: [requestId, 2, 0, detailHashes[i], salts[i]],
        }),
      });
    }

    // finalize
    const walletFin = makeWalletClient(deployerKey, rpcUrl, CHAIN_ID);
    await client.waitForTransactionReceipt({
      hash: await walletFin.writeContract({
        address: marketAddress, abi: marketAbi, functionName: 'finalize',
        args: [requestId],
      }),
    });

    // POST /detail
    await postDetail(cacheUrl, requestId, detail0);

    // GET /detail : v0 est le requester ici
    const detailResult = await getDetail(cacheUrl, v0, BigInt(CHAIN_ID), requestId, h as Hex);
    assert.ok(Array.isArray(detailResult.details));
    assert.ok(detailResult.details.length > 0, 'Aucun détail trouvé');
    const found = detailResult.details.find(d => d.verifier.toLowerCase() === v0.address.toLowerCase());
    assert.ok(found, 'Détail de v0 introuvable');
  });
});
