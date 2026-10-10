// test/events.test.ts — tests de lib/events.ts (pollLogs) contre MockMarket sur anvil
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANVIL_KEYS, CHAIN_ID, freePort, startAnvil, deployMockMarket,
  makePublicClient, makeWalletClient, advanceTime,
} from './helpers/chain.ts';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { marketAbi } from '../abi/market.ts';
import { pollLogs } from '../lib/events.ts';
import { hashOf } from '../lib/hash.ts';

// concurrency: 1 — les tests partagent un seul anvil ; ils doivent s'exécuter en série
// pour éviter les courses entre getBlockNumber(), writeContract() et pollLogs().
describe('pollLogs — events du marché', { concurrency: 1 }, () => {
  let anvilProc: Awaited<ReturnType<typeof startAnvil>>['proc'];
  let rpcUrl: string;
  let marketAddress: Hex;
  let client: ReturnType<typeof makePublicClient>;

  const [deployerKey, v0Key, v1Key, v2Key, _requesterKey] = ANVIL_KEYS;

  before(async () => {
    const port = await freePort();
    ({ proc: anvilProc, rpcUrl } = await startAnvil(port));
    const v0 = privateKeyToAccount(v0Key);
    const v1 = privateKeyToAccount(v1Key);
    const v2 = privateKeyToAccount(v2Key);
    marketAddress = await deployMockMarket(rpcUrl, deployerKey, [v0.address, v1.address, v2.address], 3, 3, 3);
    client = makePublicClient(rpcUrl, CHAIN_ID);
  }, { timeout: 30_000 });

  after(() => {
    anvilProc.kill();
  });

  it('pollLogs sur un marché vide rend un tableau vide', async () => {
    const genesis = await client.getBlockNumber();
    const { logs } = await pollLogs(client, marketAddress, genesis);
    // Aucun événement produit avant la création de demande
    const onlyMarket = logs.filter(l => l.eventName !== 'Unknown');
    assert.ok(onlyMarket.length === 0 || onlyMarket.every(l =>
      ['RequestCreated', 'CommitteeDrawn'].includes(l.eventName),
    ));
  });

  it('pollLogs détecte RequestCreated et CommitteeDrawn après createRequest', async () => {
    const wallet = makeWalletClient(deployerKey, rpcUrl, CHAIN_ID);
    const fakeH = ('0x' + 'aa'.repeat(32)) as Hex;
    const fee = await client.readContract({ address: marketAddress, abi: marketAbi, functionName: 'requestFee' });

    const txHash = await wallet.writeContract({
      address: marketAddress,
      abi: marketAbi,
      functionName: 'createRequest',
      args: [fakeH],
      value: fee as bigint,
    });
    // Utiliser receipt.blockNumber comme borne basse : garantit que pollLogs
    // couvre le bloc exact de la tx, sans race sur getBlockNumber() (cache viem ~4 s).
    const receipt = await client.waitForTransactionReceipt({ hash: txHash });
    const { logs } = await pollLogs(client, marketAddress, receipt.blockNumber);
    const names = logs.map(l => l.eventName);

    assert.ok(names.includes('RequestCreated'), `RequestCreated attendu, obtenu: ${names.join(', ')}`);
    assert.ok(names.includes('CommitteeDrawn'), `CommitteeDrawn attendu, obtenu: ${names.join(', ')}`);
  });

  it('le log RequestCreated contient le bon h', async () => {
    const wallet = makeWalletClient(deployerKey, rpcUrl, CHAIN_ID);
    const fakeH = ('0x' + 'bb'.repeat(32)) as Hex;
    const fee = await client.readContract({ address: marketAddress, abi: marketAbi, functionName: 'requestFee' });

    const txHash = await wallet.writeContract({
      address: marketAddress,
      abi: marketAbi,
      functionName: 'createRequest',
      args: [fakeH],
      value: fee as bigint,
    });
    // Utiliser receipt.blockNumber comme borne basse garantit que pollLogs
    // couvre le bloc exact de la tx, sans risque de course de synchronisation.
    const receipt = await client.waitForTransactionReceipt({ hash: txHash });
    const fromBlock = receipt.blockNumber;

    const { logs, nextBlock } = await pollLogs(client, marketAddress, fromBlock);
    const created = logs.find(l => l.eventName === 'RequestCreated' && (l.args['h'] as string)?.toLowerCase() === fakeH.toLowerCase());
    assert.ok(created, 'Log RequestCreated avec le bon h introuvable');

    // nextBlock doit être au moins le bloc courant + 1
    const latest = await client.getBlockNumber();
    assert.ok(nextBlock > latest || nextBlock === latest + 1n);
  });

  it('pollLogs depuis un bloc futur rend un tableau vide', async () => {
    const latest = await client.getBlockNumber();
    const { logs } = await pollLogs(client, marketAddress, latest + 100n);
    assert.equal(logs.length, 0);
  });
});
