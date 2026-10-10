// test/cache.test.ts — tests d'intégration du serveur de cache
// Couvre : POST /content, GET /content, POST /detail, GET /detail, suppression après RequestClosed
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { keccak256 } from 'viem';

import {
  ANVIL_KEYS, CHAIN_ID, freePort, startAnvil, deployMockMarket, advanceTime,
  makePublicClient, makeWalletClient,
} from './helpers/chain.ts';
import { startCache } from '../cache/server.ts';
import { validatePayload, deriveFacts } from '../lib/payload.ts';
import { contentHashOf, hashOf, commitmentOf } from '../lib/hash.ts';
import { signRead } from '../lib/readAuth.ts';
import { marketAbi } from '../abi/market.ts';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const VALID_PAYLOAD = {
  schemaVersion: 1,
  requester: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
  agentId: 'test-agent',
  prompt: 'Pay INV-001',
  context: {},
  plannedDecision: {
    action: 'pay',
    amountMinor: '50000',
    currency: 'EUR',
    beneficiaryId: 'FR7612345987650123456789014',
    reference: 'INV-001',
  },
  createdAt: 1700000000,
  salt: '0x' + 'ab'.repeat(32),
};

// ─── Suite ─────────────────────────────────────────────────────────────────

describe('cache server — intégration complète', () => {
  // Processus anvil et état partagé
  let anvilProc: Awaited<ReturnType<typeof startAnvil>>['proc'];
  let rpcUrl: string;
  let marketAddress: Hex;
  let cachePort: number;
  let cacheStop: () => Promise<void>;
  let writeToken: string;
  let dataDir: string;
  let anvilPort: number;

  // Comptes : deployer=0, committee=1,2,3, requester=4
  const [deployerKey, v0Key, v1Key, v2Key, requesterKey] = ANVIL_KEYS;
  const v0 = privateKeyToAccount(v0Key);
  const v1 = privateKeyToAccount(v1Key);
  const v2 = privateKeyToAccount(v2Key);
  const requester = privateKeyToAccount(requesterKey);
  const committee: [Hex, Hex, Hex] = [v0.address, v1.address, v2.address];

  before(async () => {
    anvilPort = await freePort();
    ({ proc: anvilProc, rpcUrl } = await startAnvil(anvilPort));
    // Fenêtres courtes pour les tests : commit=8s, reveal=8s, contest=8s
    marketAddress = await deployMockMarket(rpcUrl, deployerKey, committee, 8, 8, 8);

    writeToken = 'test-write-token-' + Date.now();
    dataDir = join(tmpdir(), 'team19-cache-test-' + Date.now());
    mkdirSync(dataDir, { recursive: true });

    cachePort = await freePort();
    const { stop } = await startCache({
      port: cachePort,
      dataDir,
      writeToken,
      rpcUrl,
      chainId: CHAIN_ID,
      marketAddress,
      securityAddresses: [],
    });
    cacheStop = stop;
  }, { timeout: 60_000 });

  after(async () => {
    await cacheStop();
    anvilProc.kill();
    if (existsSync(dataDir)) rmSync(dataDir, { recursive: true });
  });

  function url(path: string) {
    return `http://127.0.0.1:${cachePort}${path}`;
  }

  // ─── POST /content ──────────────────────────────────────────────────────

  it('POST /content sans token → 401', async () => {
    const res = await fetch(url('/content'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: '', facts: {} }),
    });
    assert.equal(res.status, 401);
  });

  it('POST /content payload invalide → 400', async () => {
    const res = await fetch(url('/content'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${writeToken}` },
      body: JSON.stringify({
        payload: Buffer.from('not json').toString('base64'),
        facts: { amount: '0', currency: '0x455552', beneficiaryId: '0x' + '00'.repeat(32), referenceId: '0x' + '00'.repeat(32) },
      }),
    });
    assert.equal(res.status, 400);
  });

  it('POST /content facts faux → 400', async () => {
    const payloadBytes = Buffer.from(JSON.stringify(VALID_PAYLOAD));
    const res = await fetch(url('/content'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${writeToken}` },
      body: JSON.stringify({
        payload: payloadBytes.toString('base64'),
        facts: { amount: '999', currency: '0x455552', beneficiaryId: '0x' + '00'.repeat(32), referenceId: '0x' + '00'.repeat(32) },
      }),
    });
    assert.equal(res.status, 400);
  });

  it('POST /content valide → 200 avec h correct', async () => {
    const payloadBytes = Buffer.from(JSON.stringify(VALID_PAYLOAD));
    const parsed = validatePayload(payloadBytes);
    const facts = deriveFacts(parsed);

    const res = await fetch(url('/content'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${writeToken}` },
      body: JSON.stringify({
        payload: payloadBytes.toString('base64'),
        facts: { amount: facts.amount.toString(), currency: facts.currency, beneficiaryId: facts.beneficiaryId, referenceId: facts.referenceId },
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { contentHash: string; h: string };
    assert.match(body.h, /^0x[0-9a-f]{64}$/i);
    assert.equal(body.h.toLowerCase(), hashOf(facts, contentHashOf(payloadBytes)).toLowerCase());
  });

  it('POST /content idempotent → 200 deux fois, même h', async () => {
    const payloadBytes = Buffer.from(JSON.stringify({ ...VALID_PAYLOAD, salt: '0x' + 'cd'.repeat(32) }));
    const parsed = validatePayload(payloadBytes);
    const facts = deriveFacts(parsed);
    const postBody = JSON.stringify({
      payload: payloadBytes.toString('base64'),
      facts: { amount: facts.amount.toString(), currency: facts.currency, beneficiaryId: facts.beneficiaryId, referenceId: facts.referenceId },
    });
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${writeToken}` };
    const r1 = await fetch(url('/content'), { method: 'POST', headers, body: postBody });
    const r2 = await fetch(url('/content'), { method: 'POST', headers, body: postBody });
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    const b1 = await r1.json() as { h: string };
    const b2 = await r2.json() as { h: string };
    assert.equal(b1.h, b2.h);
  });

  // ─── GET /content/{h} — avec une demande sur chaîne ────────────────────

  // Ce describe crée une vraie demande sur chaîne et stocke le payload en cache.
  // Les tests suivants s'appuient sur l'état créé ici.
  describe('GET /content/{h} avec demande sur chaîne (statut Commit)', () => {
    let h: Hex;
    let requestId: bigint;
    let payloadBytes: Buffer;

    before(async () => {
      // Préparer le payload et le stocker en cache
      const salt = '0x' + Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('hex') as Hex;
      const payload = { ...VALID_PAYLOAD, requester: requester.address.toLowerCase(), salt };
      payloadBytes = Buffer.from(JSON.stringify(payload));
      const parsed = validatePayload(payloadBytes);
      const facts = deriveFacts(parsed);

      // POST /content
      const contentRes = await fetch(url('/content'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${writeToken}` },
        body: JSON.stringify({
          payload: payloadBytes.toString('base64'),
          facts: { amount: facts.amount.toString(), currency: facts.currency, beneficiaryId: facts.beneficiaryId, referenceId: facts.referenceId },
        }),
      });
      assert.equal(contentRes.status, 200);
      const { h: storedH } = await contentRes.json() as { h: Hex; contentHash: Hex };
      h = storedH;

      // createRequest sur chaîne (signé par requester, wallet index 4)
      const wallet = makeWalletClient(requesterKey, rpcUrl, CHAIN_ID);
      const fee = await makePublicClient(rpcUrl, CHAIN_ID).readContract({
        address: marketAddress, abi: marketAbi, functionName: 'requestFee', args: [],
      }) as bigint;

      const txHash = await wallet.writeContract({
        address: marketAddress, abi: marketAbi, functionName: 'createRequest',
        args: [h], value: fee,
      });
      const receipt = await makePublicClient(rpcUrl, CHAIN_ID).waitForTransactionReceipt({ hash: txHash });
      // Lire requestId depuis les logs RequestCreated
      const client = makePublicClient(rpcUrl, CHAIN_ID);
      const logs = await client.getContractEvents({
        address: marketAddress, abi: marketAbi, eventName: 'RequestCreated',
        fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber,
      });
      const firstLog = logs[0];
      requestId = (firstLog.args as { requestId: bigint }).requestId;
    }, { timeout: 30_000 });

    it('GET /content/{h} sans en-têtes → 401', async () => {
      const res = await fetch(url(`/content/${h}?requestId=${requestId}`));
      assert.equal(res.status, 401);
    });

    it('GET /content/{h} signature expirée → 401', async () => {
      // Construire manuellement des en-têtes avec expiry passé
      const expiry = Math.floor(Date.now() / 1000) - 10;
      const { readMessage } = await import('../lib/readAuth.ts');
      const message = readMessage(BigInt(CHAIN_ID), requestId, h, expiry);
      const sig = await v0.signMessage({ message });
      const res = await fetch(url(`/content/${h}?requestId=${requestId}`), {
        headers: { 'x-address': v0.address, 'x-expiry': String(expiry), 'x-signature': sig },
      });
      assert.equal(res.status, 401);
    });

    it('GET /content/{h} membre du comité en Commit → 200, octets identiques au dépôt', async () => {
      const headers = await signRead(v0, BigInt(CHAIN_ID), requestId, h);
      const res = await fetch(url(`/content/${h}?requestId=${requestId}`), { headers });
      assert.equal(res.status, 200);
      const body = await res.json() as { payload: string; facts: unknown };
      const returned = Buffer.from(body.payload, 'base64');
      assert.deepEqual(returned, payloadBytes, 'Les octets retournés doivent être identiques à ceux déposés');
    });

    it('GET /content/{h} non-membre → 403', async () => {
      // deployer (index 0) n'est pas membre du comité (comité = index 1,2,3)
      const deployer = privateKeyToAccount(ANVIL_KEYS[0]);
      const headers = await signRead(deployer, BigInt(CHAIN_ID), requestId, h);
      const res = await fetch(url(`/content/${h}?requestId=${requestId}`), { headers });
      assert.equal(res.status, 403);
    });

    it('GET /content/{h} requester → 200', async () => {
      const headers = await signRead(requester, BigInt(CHAIN_ID), requestId, h);
      const res = await fetch(url(`/content/${h}?requestId=${requestId}`), { headers });
      assert.equal(res.status, 200);
    });

    it('GET /content/{h} h ne correspond pas au requestId → 404', async () => {
      const wrongH = ('0x' + 'dd'.repeat(32)) as Hex;
      const headers = await signRead(v0, BigInt(CHAIN_ID), requestId, wrongH);
      const res = await fetch(url(`/content/${wrongH}?requestId=${requestId}`), { headers });
      // h ne correspond pas : le contrat renvoie un h différent, donc 404
      assert.equal(res.status, 404);
    });
  });

  // ─── GET /content/{h} en statut Contest — comité → 403 ─────────────────

  describe('GET /content/{h} statut Contest : membre du comité refusé', () => {
    let h: Hex;
    let requestId: bigint;

    before(async () => {
      // Préparer un payload distinct
      const salt = ('0x' + 'cc'.repeat(32)) as Hex;
      const payload = { ...VALID_PAYLOAD, requester: requester.address.toLowerCase(), salt };
      const payloadBytes = Buffer.from(JSON.stringify(payload));
      const parsed = validatePayload(payloadBytes);
      const facts = deriveFacts(parsed);
      const contentHash = contentHashOf(payloadBytes);
      h = hashOf(facts, contentHash);

      // Stocker en cache
      const contentRes = await fetch(url('/content'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${writeToken}` },
        body: JSON.stringify({
          payload: payloadBytes.toString('base64'),
          facts: { amount: facts.amount.toString(), currency: facts.currency, beneficiaryId: facts.beneficiaryId, referenceId: facts.referenceId },
        }),
      });
      assert.equal(contentRes.status, 200);

      // createRequest
      const wallet = makeWalletClient(requesterKey, rpcUrl, CHAIN_ID);
      const client = makePublicClient(rpcUrl, CHAIN_ID);
      const fee = await client.readContract({ address: marketAddress, abi: marketAbi, functionName: 'requestFee', args: [] }) as bigint;
      const txHash = await wallet.writeContract({ address: marketAddress, abi: marketAbi, functionName: 'createRequest', args: [h], value: fee });
      const receipt = await client.waitForTransactionReceipt({ hash: txHash });
      const logs = await client.getContractEvents({ address: marketAddress, abi: marketAbi, eventName: 'RequestCreated', fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber });
      requestId = (logs[0].args as { requestId: bigint }).requestId;

      // Chaque vérificateur commit
      const detail0 = Buffer.from('{"vote":2,"reasons":[],"summary":"contest-test"}');
      const detailHash = keccak256(new Uint8Array(detail0));
      const saltV = ('0x' + '0a'.repeat(32)) as Hex;
      const commitment = commitmentOf({ chainId: BigInt(CHAIN_ID), market: marketAddress, requestId, verifier: v0.address, vote: 2, reasons: 0, detailHash, salt: saltV });
      const c1 = commitmentOf({ chainId: BigInt(CHAIN_ID), market: marketAddress, requestId, verifier: v1.address, vote: 2, reasons: 0, detailHash, salt: saltV });
      const c2 = commitmentOf({ chainId: BigInt(CHAIN_ID), market: marketAddress, requestId, verifier: v2.address, vote: 2, reasons: 0, detailHash, salt: saltV });

      const w0 = makeWalletClient(v0Key, rpcUrl, CHAIN_ID);
      const w1 = makeWalletClient(v1Key, rpcUrl, CHAIN_ID);
      const w2 = makeWalletClient(v2Key, rpcUrl, CHAIN_ID);

      for (const [w, cm] of [[w0, commitment], [w1, c1], [w2, c2]] as const) {
        const tx = await w.writeContract({ address: marketAddress, abi: marketAbi, functionName: 'commitVerdict', args: [requestId, cm] });
        await client.waitForTransactionReceipt({ hash: tx });
      }

      // Avancer dans Reveal puis reveal de tous
      await advanceTime(rpcUrl, 10);
      const transitionAbi = [{
        type: 'function',
        name: 'transitionToReveal',
        inputs: [{ name: 'requestId', type: 'uint256' }],
        outputs: [],
        stateMutability: 'nonpayable',
      }] as const;
      const transTx = await makeWalletClient(deployerKey, rpcUrl, CHAIN_ID).writeContract({
        address: marketAddress, abi: transitionAbi, functionName: 'transitionToReveal', args: [requestId],
      });
      await client.waitForTransactionReceipt({ hash: transTx });

      for (const [w] of [[w0], [w1], [w2]] as const) {
        const tx = await w.writeContract({
          address: marketAddress, abi: marketAbi, functionName: 'revealVerdict',
          args: [requestId, 2 as const, 0, detailHash, saltV],
        });
        await client.waitForTransactionReceipt({ hash: tx });
      }

      // finalize → statut Contest
      const finTx = await makeWalletClient(deployerKey, rpcUrl, CHAIN_ID).writeContract({
        address: marketAddress, abi: marketAbi, functionName: 'finalize', args: [requestId],
      });
      await client.waitForTransactionReceipt({ hash: finTx });

      // Vérifier que le statut est bien Contest
      const onChain = await client.readContract({ address: marketAddress, abi: marketAbi, functionName: 'getRequest', args: [requestId] });
      assert.equal(onChain.status, 3, 'Statut attendu : Contest (3)');
    }, { timeout: 60_000 });

    it('GET /content/{h} membre du comité en Contest → 403 (§8)', async () => {
      // v0 est membre du comité mais le statut est Contest : accès refusé
      const headers = await signRead(v0, BigInt(CHAIN_ID), requestId, h);
      const res = await fetch(url(`/content/${h}?requestId=${requestId}`), { headers });
      assert.equal(res.status, 403, 'Un membre du comité ne doit pas accéder au contenu en statut Contest');
    });

    it('GET /content/{h} requester en Contest → 200 (§8)', async () => {
      const headers = await signRead(requester, BigInt(CHAIN_ID), requestId, h);
      const res = await fetch(url(`/content/${h}?requestId=${requestId}`), { headers });
      assert.equal(res.status, 200, 'Le requester doit pouvoir accéder au contenu en statut Contest');
    });
  });

  // ─── POST /detail et GET /detail — cycle commit/reveal/finalize ──────────

  describe('POST /detail et GET /detail (cycle complet)', () => {
    let h: Hex;
    let requestId: bigint;
    let payloadBytes: Buffer;
    // Detail bytes des vérificateurs
    const detail0 = Buffer.from('{"vote":2,"reasons":[],"summary":"OK v0"}');
    const detail1 = Buffer.from('{"vote":2,"reasons":[],"summary":"OK v1"}');
    const detail2 = Buffer.from('{"vote":2,"reasons":[],"summary":"OK v2"}');

    before(async () => {
      const salt = ('0x' + 'ef'.repeat(32)) as Hex;
      const payload = { ...VALID_PAYLOAD, requester: requester.address.toLowerCase(), salt };
      payloadBytes = Buffer.from(JSON.stringify(payload));
      const parsed = validatePayload(payloadBytes);
      const facts = deriveFacts(parsed);
      const contentHash = contentHashOf(payloadBytes);
      h = hashOf(facts, contentHash);

      // Stocker en cache
      const contentRes = await fetch(url('/content'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${writeToken}` },
        body: JSON.stringify({
          payload: payloadBytes.toString('base64'),
          facts: { amount: facts.amount.toString(), currency: facts.currency, beneficiaryId: facts.beneficiaryId, referenceId: facts.referenceId },
        }),
      });
      assert.equal(contentRes.status, 200);

      // createRequest
      const wallet = makeWalletClient(requesterKey, rpcUrl, CHAIN_ID);
      const client = makePublicClient(rpcUrl, CHAIN_ID);
      const fee = await client.readContract({ address: marketAddress, abi: marketAbi, functionName: 'requestFee', args: [] }) as bigint;
      const txHash = await wallet.writeContract({ address: marketAddress, abi: marketAbi, functionName: 'createRequest', args: [h], value: fee });
      const receipt = await client.waitForTransactionReceipt({ hash: txHash });
      const logs = await client.getContractEvents({ address: marketAddress, abi: marketAbi, eventName: 'RequestCreated', fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber });
      requestId = (logs[0].args as { requestId: bigint }).requestId;

      // Chaque vérificateur commit pendant la fenêtre Commit
      const detailHash0 = keccak256(new Uint8Array(detail0));
      const detailHash1 = keccak256(new Uint8Array(detail1));
      const detailHash2 = keccak256(new Uint8Array(detail2));
      const salt0 = ('0x' + '01'.repeat(32)) as Hex;
      const salt1 = ('0x' + '02'.repeat(32)) as Hex;
      const salt2 = ('0x' + '03'.repeat(32)) as Hex;

      const commitment0 = commitmentOf({ chainId: BigInt(CHAIN_ID), market: marketAddress, requestId, verifier: v0.address, vote: 2, reasons: 0, detailHash: detailHash0, salt: salt0 });
      const commitment1 = commitmentOf({ chainId: BigInt(CHAIN_ID), market: marketAddress, requestId, verifier: v1.address, vote: 2, reasons: 0, detailHash: detailHash1, salt: salt1 });
      const commitment2 = commitmentOf({ chainId: BigInt(CHAIN_ID), market: marketAddress, requestId, verifier: v2.address, vote: 2, reasons: 0, detailHash: detailHash2, salt: salt2 });

      const w0 = makeWalletClient(v0Key, rpcUrl, CHAIN_ID);
      const w1 = makeWalletClient(v1Key, rpcUrl, CHAIN_ID);
      const w2 = makeWalletClient(v2Key, rpcUrl, CHAIN_ID);

      for (const [w, commitment] of [[w0, commitment0], [w1, commitment1], [w2, commitment2]] as const) {
        const tx = await w.writeContract({ address: marketAddress, abi: marketAbi, functionName: 'commitVerdict', args: [requestId, commitment] });
        await client.waitForTransactionReceipt({ hash: tx });
      }

      // Avancer dans la fenêtre Reveal (après commitDeadline)
      await advanceTime(rpcUrl, 10); // > 8s commit window

      // Transition Commit → Reveal (commitDeadline est maintenant dépassée)
      const transitionAbi = [{
        type: 'function',
        name: 'transitionToReveal',
        inputs: [{ name: 'requestId', type: 'uint256' }],
        outputs: [],
        stateMutability: 'nonpayable',
      }] as const;
      const transTx = await makeWalletClient(deployerKey, rpcUrl, CHAIN_ID).writeContract({
        address: marketAddress, abi: transitionAbi, functionName: 'transitionToReveal', args: [requestId],
      });
      await client.waitForTransactionReceipt({ hash: transTx });
      for (const [w, vote, det, dh, s] of [
        [w0, 2, detail0, detailHash0, salt0],
        [w1, 2, detail1, detailHash1, salt1],
        [w2, 2, detail2, detailHash2, salt2],
      ] as const) {
        const tx = await w.writeContract({
          address: marketAddress, abi: marketAbi, functionName: 'revealVerdict',
          args: [requestId, vote as 0 | 1 | 2, 0, dh, s],
        });
        await client.waitForTransactionReceipt({ hash: tx });
      }

      // finalize
      const finTx = await makeWalletClient(deployerKey, rpcUrl, CHAIN_ID).writeContract({
        address: marketAddress, abi: marketAbi, functionName: 'finalize', args: [requestId],
      });
      await client.waitForTransactionReceipt({ hash: finTx });
    }, { timeout: 60_000 });

    it('POST /detail avec hash correspondant au reveal → 200', async () => {
      const res = await fetch(url(`/detail/${requestId}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: detail0,
      });
      assert.equal(res.status, 200);
    });

    it('POST /detail avec hash ne correspondant à aucun reveal → 409', async () => {
      const wrongBytes = Buffer.from('wrong content completely different');
      const res = await fetch(url(`/detail/${requestId}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: wrongBytes,
      });
      assert.equal(res.status, 409);
    });

    it('GET /detail/{requestId} avant Contest → refusé (après finalize = Contest ici)', async () => {
      // La demande est déjà en Contest après finalize — on teste que seul le requester peut lire
      // et qu'un non-autorisé (committee member) ne peut pas
      const headers = await signRead(v0, BigInt(CHAIN_ID), requestId, h);
      const res = await fetch(url(`/detail/${requestId}`), { headers });
      // v0 est membre du comité mais pas requester ni sécurité → 403
      assert.equal(res.status, 403);
    });

    it('GET /detail/{requestId} en Contest par le requester → 200', async () => {
      // D'abord déposer les autres détails
      await fetch(url(`/detail/${requestId}`), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: detail1 });
      await fetch(url(`/detail/${requestId}`), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: detail2 });

      const headers = await signRead(requester, BigInt(CHAIN_ID), requestId, h);
      const res = await fetch(url(`/detail/${requestId}`), { headers });
      assert.equal(res.status, 200);
      const body = await res.json() as { details: { verifier: string; detail: string }[] };
      assert(Array.isArray(body.details));
      assert(body.details.length >= 1);
    });

    it('suppression après RequestClosed (evm_increaseTime + evm_mine)', async () => {
      // Avancer au-delà du contestDeadline pour pouvoir close
      await advanceTime(rpcUrl, 12); // > 8s contest window

      const client = makePublicClient(rpcUrl, CHAIN_ID);
      const closeTx = await makeWalletClient(deployerKey, rpcUrl, CHAIN_ID).writeContract({
        address: marketAddress, abi: marketAbi, functionName: 'close', args: [requestId],
      });
      await client.waitForTransactionReceipt({ hash: closeTx });

      // Attendre que la boucle de cleanup du cache détecte l'événement
      // La boucle tourne toutes les 5s — on attend un peu plus
      await new Promise(res => setTimeout(res, 7000));

      // Le contenu doit avoir été supprimé du disque
      const contentPath = join(dataDir, 'content', `${h}.bin`);
      assert(!existsSync(contentPath), `Le fichier de contenu ${h}.bin devrait avoir été supprimé après RequestClosed`);
    }, { timeout: 20_000 });
  });

  it('route inconnue → 404', async () => {
    const res = await fetch(url('/unknown-route'));
    assert.equal(res.status, 404);
  });
});
