// test/revert.test.ts — classement des annulations (lib/revert.ts)
//
// Trois classes sur le NOM de l'erreur décodée, jamais sur une sous-chaîne du message :
//   done  : l'étape est déjà faite, elle avance
//   early : trop tôt pour la chaîne, on réessaie
//   fatal : définitif, un incident et plus de relance
// Tout le reste est unknown.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

import {
  ANVIL_KEYS, CHAIN_ID, freePort, startAnvil, deployRealMarket, advanceTime,
  makePublicClient, makeWalletClient,
} from './helpers/chain.ts';
import { marketAbi } from '../abi/market.ts';
import { marketAbiWithErrors } from '../abi/marketErrors.ts';
import { revertName, classifyRevert } from '../lib/revert.ts';

describe('classifyRevert — table des classes', () => {
  const table: [string | undefined, string][] = [
    ['AlreadyCommitted', 'done'],
    ['AlreadyRevealed', 'done'],
    ['WrongPhase', 'early'],
    ['TooEarly', 'early'],
    ['CommitmentMismatch', 'fatal'],
    ['NoCommitment', 'fatal'],
    ['NotCommitteeMember', 'fatal'],
    ['RevealWindowClosed', 'fatal'],
    ['UnknownRequest', 'fatal'],
    ['InsufficientFee', 'unknown'],
    ['revert', 'unknown'],
    ['', 'unknown'],
    [undefined, 'unknown'],
  ];
  for (const [name, expected] of table) {
    it(`${JSON.stringify(name)} → ${expected}`, () => {
      assert.equal(classifyRevert(name), expected, `classe de ${JSON.stringify(name)}`);
    });
  }
});

describe('revertName — pas de classement par sous-chaîne', () => {
  it('une erreur ordinaire dont le message cite WrongPhase ou revert ne porte aucun nom', () => {
    for (const msg of ['execution reverted: WrongPhase', 'Transaction reverted', 'AlreadyRevealed', 'TooEarly']) {
      const name = revertName(new Error(msg));
      assert.equal(name, undefined, `message « ${msg} » : aucun nom décodé attendu`);
      assert.equal(classifyRevert(name), 'unknown', `message « ${msg} » : classe unknown attendue`);
    }
  });

  it('une valeur qui n\'est pas une erreur ne porte aucun nom', () => {
    for (const v of [undefined, null, 'revert', 42, {}]) {
      assert.equal(revertName(v), undefined, `valeur ${JSON.stringify(v)}`);
    }
  });
});

describe('revertName — erreurs réelles du vrai marché', { concurrency: false }, () => {
  let anvilProc: Awaited<ReturnType<typeof startAnvil>>['proc'];
  let rpcUrl: string;
  let marketAddress: Hex;
  let requestId: bigint;

  const [deployerKey, v0Key, v1Key, v2Key, requesterKey] = ANVIL_KEYS;
  const v0 = privateKeyToAccount(v0Key);
  const v1 = privateKeyToAccount(v1Key);
  const v2 = privateKeyToAccount(v2Key);
  const requester = privateKeyToAccount(requesterKey);
  const ZERO32 = ('0x' + '00'.repeat(32)) as Hex;

  const COMMIT_WINDOW = 60;
  const REVEAL_WINDOW = 60;

  before(async () => {
    const anvilPort = await freePort();
    ({ proc: anvilProc, rpcUrl } = await startAnvil(anvilPort));
    marketAddress = await deployRealMarket(
      rpcUrl, deployerKey, [v0.address, v1.address, v2.address],
      COMMIT_WINDOW, REVEAL_WINDOW, 60,
    );

    const client = makePublicClient(rpcUrl, CHAIN_ID);
    const wallet = makeWalletClient(requesterKey, rpcUrl, CHAIN_ID);
    const fee = await client.readContract({ address: marketAddress, abi: marketAbi, functionName: 'requestFee' });
    const txHash = await wallet.writeContract({
      address: marketAddress, abi: marketAbi, functionName: 'createRequest',
      args: [('0x' + '11'.repeat(32)) as Hex], value: fee as bigint,
    });
    const receipt = await client.waitForTransactionReceipt({ hash: txHash });
    assert.equal(receipt.status, 'success', 'createRequest annulée');
    const logs = await client.getContractEvents({
      address: marketAddress, abi: marketAbi, eventName: 'RequestCreated', fromBlock: 0n,
    });
    requestId = (logs[0].args as { requestId?: bigint }).requestId!;
  }, { timeout: 120_000 });

  after(() => { anvilProc.kill(); });

  // Simule un appel et rend l'erreur levée ; échoue si l'appel passe.
  async function simulateError(
    abi: typeof marketAbi | typeof marketAbiWithErrors,
    functionName: 'commitVerdict' | 'revealVerdict' | 'finalize' | 'close',
    args: readonly unknown[],
    account: Hex,
  ): Promise<unknown> {
    const client = makePublicClient(rpcUrl, CHAIN_ID);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await client.simulateContract({ address: marketAddress, abi, functionName, args, account } as any);
    } catch (err) {
      return err;
    }
    assert.fail(`${functionName} aurait dû être annulé`);
  }

  it('close sur une demande inconnue → UnknownRequest, fatal', async () => {
    const err = await simulateError(marketAbiWithErrors, 'close', [999n], requester.address);
    assert.equal(revertName(err), 'UnknownRequest');
    assert.equal(classifyRevert(revertName(err)), 'fatal');
  });

  it('commit par une adresse hors comité → NotCommitteeMember, fatal', async () => {
    const err = await simulateError(marketAbiWithErrors, 'commitVerdict', [requestId, ZERO32], requester.address);
    assert.equal(revertName(err), 'NotCommitteeMember');
    assert.equal(classifyRevert(revertName(err)), 'fatal');
  });

  it('reveal pendant la fenêtre de commit → WrongPhase, early', async () => {
    const err = await simulateError(marketAbiWithErrors, 'revealVerdict', [requestId, 2, 0, ZERO32, ZERO32], v0.address);
    assert.equal(revertName(err), 'WrongPhase');
    assert.equal(classifyRevert(revertName(err)), 'early');
  });

  it('finalize avant revealDeadline sans 3 reveals → TooEarly, early', async () => {
    await advanceTime(rpcUrl, COMMIT_WINDOW + 1);
    const err = await simulateError(marketAbiWithErrors, 'finalize', [requestId], requester.address);
    assert.equal(revertName(err), 'TooEarly');
    assert.equal(classifyRevert(revertName(err)), 'early');
  });

  it('reveal après revealDeadline → RevealWindowClosed, fatal, décodé grâce à marketAbiWithErrors', async () => {
    await advanceTime(rpcUrl, REVEAL_WINDOW + 1);
    const args = [requestId, 2, 0, ZERO32, ZERO32] as const;

    const decoded = await simulateError(marketAbiWithErrors, 'revealVerdict', args, v0.address);
    assert.equal(revertName(decoded), 'RevealWindowClosed', 'avec l\'ABI étendue');
    assert.equal(classifyRevert(revertName(decoded)), 'fatal');

    // L'interface ne déclare pas cette erreur : avec l'ABI générée seule, elle reste sans nom.
    const opaque = await simulateError(marketAbi, 'revealVerdict', args, v0.address);
    assert.equal(revertName(opaque), undefined, 'avec abi/market.ts seule, le nom n\'est pas décodable');
  });
});
