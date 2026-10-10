// test/hash.test.ts — tests de contentHashOf, hashOf, commitmentOf
// Vecteurs croisés : calcul TS vs cast abi-encode/keccak (execFileSync) vs MockMarket sur anvil
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { keccak256, toBytes } from 'viem';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { contentHashOf, hashOf, commitmentOf } from '../lib/hash.ts';
import { publicClient as makePublicClient } from '../lib/chain.ts';
import { marketAbi } from '../abi/market.ts';
import type { Facts } from '../lib/payload.ts';

// Clés dérivées depuis le helper (jamais de littéraux en clair)
import { ANVIL_KEYS, CHAIN_ID, freePort, startAnvil, deployMockMarket } from './helpers/chain.ts';

const FORGE = process.env['FORGE'] ?? '/home/wladimir/.foundry/bin/forge';
const ANVIL  = process.env['ANVIL']  ?? '/home/wladimir/.foundry/bin/anvil';
const CAST   = process.env['CAST']   ?? '/home/wladimir/.foundry/bin/cast';

// ─── helpers cast ─────────────────────────────────────────────────────────────

function castAbiEncode(sig: string, ...args: string[]): string {
  return execFileSync(CAST, ['abi-encode', sig, ...args], { encoding: 'utf8' }).trim();
}

function castKeccak(hex: string): Hex {
  return execFileSync(CAST, ['keccak', hex], { encoding: 'utf8' }).trim() as Hex;
}

// contentHash via cast : keccak256 des octets bruts
// cast keccak <hex-encoded-bytes>
function castContentHash(bytes: Buffer): Hex {
  const hex = '0x' + bytes.toString('hex');
  return castKeccak(hex);
}

// hashOf via cast
function castHashOf(facts: Facts, contentHash: Hex): Hex {
  const encoded = castAbiEncode(
    'f((uint256,bytes3,bytes32,bytes32),bytes32)',
    `(${facts.amount},${facts.currency},${facts.beneficiaryId},${facts.referenceId})`,
    contentHash,
  );
  return castKeccak(encoded);
}

// commitmentOf via cast
function castCommitmentOf(params: {
  chainId: bigint;
  market: Hex;
  requestId: bigint;
  verifier: Hex;
  vote: number;
  reasons: number;
  detailHash: Hex;
  salt: Hex;
}): Hex {
  const encoded = castAbiEncode(
    'f(uint256,address,uint256,address,uint8,uint16,bytes32,bytes32)',
    params.chainId.toString(),
    params.market,
    params.requestId.toString(),
    params.verifier,
    params.vote.toString(),
    params.reasons.toString(),
    params.detailHash,
    params.salt,
  );
  return castKeccak(encoded);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ZERO32 = ('0x' + '00'.repeat(32)) as Hex;

// Fixture 1 : facts normaux
const FACTS1: Facts = {
  amount:        123456n,
  currency:      '0x455552' as Hex, // EUR
  beneficiaryId: keccak256(toBytes('FR7612345987650123456789014')),
  referenceId:   keccak256(toBytes('INV-001')),
};
const CONTENT_HASH1 = ('0x' + 'aa'.repeat(32)) as Hex;

// Fixture 2 : referenceId nul (reference vide → 0x00…00)
const FACTS2: Facts = {
  amount:        0n,
  currency:      '0x434846' as Hex, // CHF
  beneficiaryId: keccak256(toBytes('CH5604835012345678009')),
  referenceId:   ZERO32, // référence vide
};
const CONTENT_HASH2 = ('0x' + 'bb'.repeat(32)) as Hex;

// Fixture 3 : montant max uint256-ish, currency USD
const FACTS3: Facts = {
  amount:        999999999999999999n,
  currency:      '0x555344' as Hex, // USD
  beneficiaryId: keccak256(toBytes('US1234567890')),
  referenceId:   keccak256(toBytes('PO-2024-XYZ')),
};
const CONTENT_HASH3 = ('0x' + 'cc'.repeat(32)) as Hex;

// ─── Suite contentHashOf ──────────────────────────────────────────────────────

describe('contentHashOf', () => {
  it('égale cast keccak pour "hello world"', () => {
    const bytes = Buffer.from('hello world');
    const fromCast = castContentHash(bytes);
    assert.equal(contentHashOf(bytes), fromCast);
  });

  it('égale cast keccak pour un payload JSON (fixture 1)', () => {
    const bytes = Buffer.from(JSON.stringify({ test: 'fixture1', n: 123456 }));
    const fromCast = castContentHash(bytes);
    assert.equal(contentHashOf(bytes), fromCast);
  });

  it('deux buffers identiques → même hash', () => {
    const a = Buffer.from('same');
    const b = Buffer.from('same');
    assert.equal(contentHashOf(a), contentHashOf(b));
  });

  it('deux buffers différents → hashes différents', () => {
    assert.notEqual(contentHashOf(Buffer.from('a')), contentHashOf(Buffer.from('b')));
  });
});

// ─── Suite hashOf ─────────────────────────────────────────────────────────────

describe('hashOf', () => {
  it('[fixture 1] égale cast abi-encode+keccak (facts normaux, referenceId non nul)', () => {
    const castH = castHashOf(FACTS1, CONTENT_HASH1);
    assert.equal(hashOf(FACTS1, CONTENT_HASH1), castH);
  });

  it('[fixture 2] égale cast abi-encode+keccak (referenceId = 0x00…00)', () => {
    const castH = castHashOf(FACTS2, CONTENT_HASH2);
    assert.equal(hashOf(FACTS2, CONTENT_HASH2), castH);
  });

  it('[fixture 3] égale cast abi-encode+keccak (montant élevé, USD)', () => {
    const castH = castHashOf(FACTS3, CONTENT_HASH3);
    assert.equal(hashOf(FACTS3, CONTENT_HASH3), castH);
  });

  it('changer contentHash change le résultat', () => {
    const h1 = hashOf(FACTS1, CONTENT_HASH1);
    const h2 = hashOf(FACTS1, CONTENT_HASH2);
    assert.notEqual(h1, h2);
  });

  it('changer amount change le résultat', () => {
    assert.notEqual(
      hashOf(FACTS1, CONTENT_HASH1),
      hashOf({ ...FACTS1, amount: 999n }, CONTENT_HASH1),
    );
  });

  it('changer referenceId (nul vs non nul) change le résultat', () => {
    assert.notEqual(
      hashOf(FACTS1, CONTENT_HASH1),
      hashOf({ ...FACTS1, referenceId: ZERO32 }, CONTENT_HASH1),
    );
  });
});

// ─── Suite commitmentOf ───────────────────────────────────────────────────────

describe('commitmentOf', () => {
  const BASE = {
    chainId:    191919n,
    market:     '0x1111111111111111111111111111111111111111' as Hex,
    requestId:  1n,
    verifier:   '0x2222222222222222222222222222222222222222' as Hex,
    vote:       2,
    reasons:    0,
    detailHash: ZERO32,
    salt:       ('0x' + 'ff'.repeat(32)) as Hex,
  };

  it('égale cast abi-encode+keccak (vote=2, reasons=0)', () => {
    const castC = castCommitmentOf(BASE);
    assert.equal(commitmentOf(BASE), castC);
  });

  it('égale cast abi-encode+keccak (vote=0, reasons=1)', () => {
    const params = { ...BASE, vote: 0, reasons: 1 };
    assert.equal(commitmentOf(params), castCommitmentOf(params));
  });

  it('égale cast abi-encode+keccak (vote=1, reasons=640)', () => {
    const params = { ...BASE, vote: 1, reasons: 640 }; // bits 7+9
    assert.equal(commitmentOf(params), castCommitmentOf(params));
  });

  it('changer le vote change le commitment', () => {
    assert.notEqual(
      commitmentOf({ ...BASE, vote: 0 }),
      commitmentOf({ ...BASE, vote: 2 }),
    );
  });

  it('changer le sel change le commitment', () => {
    assert.notEqual(
      commitmentOf({ ...BASE, salt: ('0x' + 'aa'.repeat(32)) as Hex }),
      commitmentOf({ ...BASE, salt: ('0x' + 'bb'.repeat(32)) as Hex }),
    );
  });

  it('changer le requestId change le commitment', () => {
    assert.notEqual(
      commitmentOf({ ...BASE, requestId: 1n }),
      commitmentOf({ ...BASE, requestId: 2n }),
    );
  });
});

// ─── Suite comparaison avec MockMarket sur anvil ──────────────────────────────

describe('hashOf / commitmentOf vs MockMarket on anvil', () => {
  let anvilProc: Awaited<ReturnType<typeof startAnvil>>['proc'];
  let client: ReturnType<typeof makePublicClient>;
  let marketAddress: Hex;

  before(async () => {
    const port = await freePort();
    const [deployerKey, v0Key, v1Key, v2Key] = ANVIL_KEYS;
    const v0 = privateKeyToAccount(v0Key);
    const v1 = privateKeyToAccount(v1Key);
    const v2 = privateKeyToAccount(v2Key);

    ({ proc: anvilProc } = await startAnvil(port));
    const rpcUrl = `http://127.0.0.1:${port}`;
    marketAddress = await deployMockMarket(rpcUrl, deployerKey, [v0.address, v1.address, v2.address]);
    client = makePublicClient(rpcUrl, CHAIN_ID);
  }, { timeout: 30_000 });

  after(() => {
    anvilProc.kill();
  });

  it('[fixture 1] hashOf TS == MockMarket.hashOf (facts normaux)', async () => {
    const tsH = hashOf(FACTS1, CONTENT_HASH1);
    const chainH = await client.readContract({
      address: marketAddress,
      abi: marketAbi,
      functionName: 'hashOf',
      args: [
        {
          amount:        FACTS1.amount,
          currency:      FACTS1.currency,
          beneficiaryId: FACTS1.beneficiaryId,
          referenceId:   FACTS1.referenceId,
        },
        CONTENT_HASH1,
      ],
    });
    assert.equal(tsH.toLowerCase(), (chainH as Hex).toLowerCase());
  });

  it('[fixture 2] hashOf TS == MockMarket.hashOf (referenceId = 0x00…00)', async () => {
    const tsH = hashOf(FACTS2, CONTENT_HASH2);
    const chainH = await client.readContract({
      address: marketAddress,
      abi: marketAbi,
      functionName: 'hashOf',
      args: [
        {
          amount:        FACTS2.amount,
          currency:      FACTS2.currency,
          beneficiaryId: FACTS2.beneficiaryId,
          referenceId:   FACTS2.referenceId,
        },
        CONTENT_HASH2,
      ],
    });
    assert.equal(tsH.toLowerCase(), (chainH as Hex).toLowerCase());
  });

  it('[fixture 1] commitmentOf TS == MockMarket.commitmentOf', async () => {
    const params = {
      chainId:    BigInt(CHAIN_ID),
      market:     marketAddress,
      requestId:  1n,
      verifier:   '0x2222222222222222222222222222222222222222' as Hex,
      vote:       2,
      reasons:    0,
      detailHash: ZERO32,
      salt:       ('0x' + 'ff'.repeat(32)) as Hex,
    };
    const tsC = commitmentOf(params);
    const chainC = await client.readContract({
      address: marketAddress,
      abi: marketAbi,
      functionName: 'commitmentOf',
      args: [
        params.requestId,
        params.verifier,
        2, // Code.Accept
        params.reasons,
        params.detailHash,
        params.salt,
      ],
    });
    assert.equal(tsC.toLowerCase(), (chainC as Hex).toLowerCase());
  });
});
