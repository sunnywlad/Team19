// test/readAuth.test.ts — tests de readMessage, signRead, verifyRead
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mnemonicToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { readMessage, signRead, verifyRead } from '../lib/readAuth.ts';

// Comptes anvil (mnemonic public connu)
const MNEMONIC = 'test test test test test test test test test test test junk';
const account  = mnemonicToAccount(MNEMONIC, { addressIndex: 0 }); // signataire légitime
const other    = mnemonicToAccount(MNEMONIC, { addressIndex: 1 }); // mauvais signataire

const CHAIN_ID   = 191919n;
const REQUEST_ID = 1n;
const H = ('0x' + 'ab'.repeat(32)) as Hex;

describe('readMessage', () => {
  it('construit le bon préfixe', () => {
    const msg = readMessage(CHAIN_ID, REQUEST_ID, H, 9999);
    assert(msg.startsWith('team19-cache-read:'));
    assert(msg.includes(':191919:'));
    assert(msg.includes(':9999'));
    assert(msg.includes(`:${H}:`));
  });
});

describe('signRead + verifyRead', () => {
  it('vérifie une signature valide', async () => {
    const headers = await signRead(account, CHAIN_ID, REQUEST_ID, H);
    const result = await verifyRead(headers, CHAIN_ID, REQUEST_ID, H);
    assert(result.ok, `verifyRead a échoué: ${(result as { reason: string }).reason ?? ''}`);
    assert.equal(
      (result as { address: string }).address.toLowerCase(),
      account.address.toLowerCase(),
    );
  });

  it('rejette une signature expirée', async () => {
    const expiry = Math.floor(Date.now() / 1000) - 10; // passé
    const message = readMessage(CHAIN_ID, REQUEST_ID, H, expiry);
    const sig = await account.signMessage({ message });
    const headers = {
      'x-address':   account.address,
      'x-expiry':    String(expiry),
      'x-signature': sig,
    };
    const result = await verifyRead(headers, CHAIN_ID, REQUEST_ID, H);
    assert(!result.ok, 'devrait rejeter une expiry passée');
    assert.equal((result as { code: number }).code, 401);
  });

  it('rejette un expiry trop loin dans le futur (> 60 s)', async () => {
    const expiry = Math.floor(Date.now() / 1000) + 120; // 2 min dans le futur
    const message = readMessage(CHAIN_ID, REQUEST_ID, H, expiry);
    const sig = await account.signMessage({ message });
    const headers = {
      'x-address':   account.address,
      'x-expiry':    String(expiry),
      'x-signature': sig,
    };
    const result = await verifyRead(headers, CHAIN_ID, REQUEST_ID, H);
    assert(!result.ok, 'devrait rejeter un expiry trop éloigné');
    assert.equal((result as { code: number }).code, 401);
  });

  it('rejette un mauvais signataire (signature account[1] présentée avec adresse account[0])', async () => {
    // other signe le message, mais on prétend que l'adresse est account[0]
    const expiry = Math.floor(Date.now() / 1000) + 30;
    const message = readMessage(CHAIN_ID, REQUEST_ID, H, expiry);
    const sig = await other.signMessage({ message }); // signé par un autre
    const headers = {
      'x-address':   account.address, // adresse légitime présentée
      'x-expiry':    String(expiry),
      'x-signature': sig,             // mais signature de quelqu'un d'autre
    };
    const result = await verifyRead(headers, CHAIN_ID, REQUEST_ID, H);
    assert(!result.ok, 'devrait rejeter un mauvais signataire');
    assert.equal((result as { code: number }).code, 401);
  });

  it('rejette une signature pour un h différent', async () => {
    const headers = await signRead(account, CHAIN_ID, REQUEST_ID, H);
    const wrongH = ('0x' + 'cc'.repeat(32)) as Hex;
    const result = await verifyRead(headers, CHAIN_ID, REQUEST_ID, wrongH);
    assert(!result.ok, 'devrait rejeter un h différent');
    assert.equal((result as { code: number }).code, 401);
  });

  it('rejette des en-têtes manquants', async () => {
    const result = await verifyRead({}, CHAIN_ID, REQUEST_ID, H);
    assert(!result.ok, 'devrait rejeter des en-têtes manquants');
    assert.equal((result as { code: number }).code, 401);
  });
});
