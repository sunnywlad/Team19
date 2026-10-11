import { it } from 'node:test';
import assert from 'node:assert/strict';
import { ContractFunctionRevertedError, encodeErrorResult } from 'viem';
import type { Hex, TransactionReceipt } from 'viem';
import { marketAbiWithErrors } from '../abi/marketErrors.ts';
import { registryAbi } from '../abi/registry.ts';
import { classifyRevert, sendControlled, GAS_DRAW, GAS_REGISTER } from '../lib/revert.ts';
import type { publicClient, walletClient } from '../lib/chain.ts';

const ADDRESS = '0x0000000000000000000000000000000000000001' as Hex;
const HASH = ('0x' + '11'.repeat(32)) as Hex;

function fixture(
  simulate: (request: Record<string, unknown>) => Promise<unknown> = async () => ({}),
  status: 'success' | 'reverted' = 'success',
) {
  const sent: Record<string, unknown>[] = [];
  const simulated: Record<string, unknown>[] = [];
  const receipt = { status, blockNumber: 42n, logs: [] } as unknown as TransactionReceipt;
  const pc = {
    simulateContract: async (request: Record<string, unknown>) => {
      simulated.push(request);
      return simulate(request);
    },
    waitForTransactionReceipt: async () => receipt,
  } as unknown as ReturnType<typeof publicClient>;
  const wc = {
    account: { address: ADDRESS },
    writeContract: async (request: Record<string, unknown>) => {
      sent.push(request);
      return HASH;
    },
  } as unknown as ReturnType<typeof walletClient>;
  return { pc, wc, sent, simulated, receipt };
}

function drawError(name: 'TooEarly' | 'AlreadyDrawn' | 'NotEnoughVerifiers') {
  return new ContractFunctionRevertedError({
    abi: marketAbiWithErrors,
    functionName: 'drawCommittee',
    data: encodeErrorResult({
      abi: marketAbiWithErrors,
      errorName: name,
      args: name === 'NotEnoughVerifiers' ? [1n, 2n] : [1n],
    }),
  });
}

it('phase 3 : AlreadyDrawn est acquis et NotEnoughVerifiers est définitif', () => {
  assert.equal(classifyRevert('AlreadyDrawn'), 'done', 'AlreadyDrawn signifie que le comité est déjà tiré');
  assert.equal(classifyRevert('NotEnoughVerifiers'), 'fatal', 'Un manque de vérificateurs ne doit pas provoquer une relance automatique');
});

it('register : la valeur du complément est simulée puis envoyée avec GAS_REGISTER', async () => {
  const f = fixture();
  const result = await sendControlled({
    publicClient: f.pc, walletClient: f.wc, address: ADDRESS,
    abi: registryAbi, call: { functionName: 'register', args: [], value: 500n }, force: false,
  });
  const seen = JSON.stringify(f.sent, (_, value) => typeof value === 'bigint' ? value.toString() : value);
  assert.equal(result.status, 'success', 'Le reçu réussi confirme le dépôt de caution');
  assert.equal(f.simulated[0].value, 500n, 'La simulation payable reçoit le même complément que l’envoi');
  assert.equal(f.simulated[0].account, f.wc.account, 'La simulation doit utiliser le compte inscrit');
  assert.equal(f.sent.length, 1, `Un seul register est envoyé après simulation, appels vus : ${seen}`);
  assert.equal(f.sent[0].value, 500n, `Le montant du complément est préservé, appels vus : ${seen}`);
  assert.equal(f.sent[0].gas, GAS_REGISTER, `register utilise sa limite explicite, appels vus : ${seen}`);
});

it('drawCommittee : TooEarly sur reçu est décodé au bloc du reçu et reste à relancer', async () => {
  const f = fixture(async () => { throw drawError('TooEarly'); }, 'reverted');
  const result = await sendControlled({
    publicClient: f.pc, walletClient: f.wc, address: ADDRESS,
    abi: marketAbiWithErrors, call: { functionName: 'drawCommittee', args: [1n] }, force: true,
  });
  const seen = `drawCommittee:${f.receipt.status}@${f.receipt.blockNumber}, gas=${f.sent[0]?.gas}`;
  assert.equal(result.status, 'reverted', `Un reçu annulé ne confirme aucun tirage, vu : ${seen}`);
  if (result.status !== 'reverted') assert.fail('Le résultat doit rester annulé pour que l’appelant puisse relancer');
  assert.equal(result.name, 'TooEarly', 'Le nom du revert doit être décodé sans recherche dans un message');
  assert.equal(result.classe, 'early', 'TooEarly conserve le droit à une nouvelle tentative');
  assert.equal(result.sent, true, `Le tirage forcé a réellement été envoyé, vu : ${seen}`);
  assert.equal(f.sent.length, 1, `Le helper ne relance pas lui-même le tirage, vu : ${seen}`);
  assert.equal(f.sent[0].gas, GAS_DRAW, `Le tirage forcé utilise GAS_DRAW, vu : ${seen}`);
  assert.equal(f.simulated.length, 2, 'Une simulation initiale puis un rejeu doivent expliquer le reçu annulé');
  assert.equal(f.simulated[0].blockTag, 'latest', 'La première simulation lit le dernier bloc');
  assert.equal(f.simulated[1].blockNumber, 42n, 'Le rejeu doit lire le bloc du reçu, pas un bloc ultérieur');
});

it('drawCommittee : NotEnoughVerifiers conserve les deux éligibles sans envoyer même avec force', async () => {
  const f = fixture(async () => { throw drawError('NotEnoughVerifiers'); });
  const result = await sendControlled({
    publicClient: f.pc, walletClient: f.wc, address: ADDRESS,
    abi: marketAbiWithErrors, call: { functionName: 'drawCommittee', args: [1n] }, force: true,
  });
  assert.equal(result.status, 'reverted', 'Le manque d’éligibles doit revenir comme résultat annulé');
  if (result.status !== 'reverted') assert.fail('Le résultat doit porter les arguments décodés du manque d’éligibles');
  assert.deepEqual(result.args, [1n, 2n], 'La passerelle a besoin du nombre exact de deux éligibles pour son journal');
  assert.equal(result.sent, false, 'Une annulation définitive en simulation ne doit jamais être forcée');
  assert.equal(f.sent.length, 0, `Aucun envoi attendu pour NotEnoughVerifiers, appels vus : ${JSON.stringify(f.sent)}`);
});

it('drawCommittee : AlreadyDrawn est acquis sans transaction supplémentaire', async () => {
  const f = fixture(async () => { throw drawError('AlreadyDrawn'); });
  const result = await sendControlled({
    publicClient: f.pc, walletClient: f.wc, address: ADDRESS,
    abi: marketAbiWithErrors, call: { functionName: 'drawCommittee', args: [1n] }, force: true,
  });
  assert.equal(result.status, 'reverted', 'AlreadyDrawn est un résultat de simulation, pas un faux reçu réussi');
  if (result.status !== 'reverted') assert.fail('AlreadyDrawn doit porter la classe done pour la passerelle');
  assert.equal(result.classe, 'done', 'La passerelle peut tenir le comité pour acquis');
  assert.equal(f.sent.length, 0, `Le comité acquis ne justifie aucun nouvel envoi, appels vus : ${JSON.stringify(f.sent)}`);
});

it('drawCommittee : le reçu réussi est exposé pour distinguer CommitteeDrawn de DrawRescheduled', async () => {
  const f = fixture();
  const result = await sendControlled({
    publicClient: f.pc, walletClient: f.wc, address: ADDRESS,
    abi: marketAbiWithErrors, call: { functionName: 'drawCommittee', args: [1n] }, force: true,
  });
  assert.equal(result.status, 'success', 'Un reçu réussi doit pouvoir être inspecté par la passerelle');
  if (result.status !== 'success') assert.fail('Le succès doit exposer son reçu pour vérifier les événements');
  assert.equal(result.receipt, f.receipt, 'Le reçu exact, avec ses journaux, doit être conservé');
});
