/**
 * Tests de l'évaluateur LLM (evaluator-llm/evaluator.py) en mode simulé.
 *
 * L'évaluateur est lancé exactement comme le fait le service : runEvaluator de
 * verifier/evaluator.ts, donc `sh -c EVALUATOR_CMD`, payload sur stdin,
 * environnement filtré. Vérifie qu'il respecte le même contrat que le stub :
 *   - mêmes votes et mêmes masques de motifs que le stub sur les paliers durs ;
 *   - verdict LLM simulé (LLM_FAKE) accepté par le service ;
 *   - réponse invalide du modèle → vote 1, jamais 2 ;
 *   - erreur (modèle absent) → evaluator_error ;
 *   - une variable posée dans l'environnement du service n'arrive pas au script :
 *     elle doit figurer dans EVALUATOR_CMD.
 * Aucun appel réseau. Python : LLM_TEST_PYTHON, sinon python3 du PATH.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runEvaluator } from '../verifier/evaluator.ts';
import { REASON_BITS } from '../lib/reasons.ts';

const OFFCHAIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(OFFCHAIN_DIR, 'evaluator-llm', 'evaluator.py');
const STUB_CMD = `node '${join(OFFCHAIN_DIR, 'evaluator-stub', 'index.ts')}'`;
const PYTHON = process.env.LLM_TEST_PYTHON ?? 'python3';
const TIMEOUT_MS = 15_000;

const bit = (name: string): number => 1 << REASON_BITS[name]!;

function payload(amountMinor: string): Buffer {
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    requester: '0x' + 'ab'.repeat(20),
    agentId: 'test-agent',
    prompt: 'Payer la facture jointe',
    context: { document: 'Facture n° 12, 435,19 €' },
    plannedDecision: {
      action: 'PAY_INVOICE',
      amountMinor,
      currency: 'EUR',
      beneficiaryId: 'BENEF1',
      reference: 'INV-1',
    },
    createdAt: 1760000000,
    salt: '0x' + '00'.repeat(32),
  }));
}

/** Commande LLM simulée ; la réponse JSON ne contient pas d'apostrophe. */
function llmCmd(fake?: string): string {
  const vars = fake === undefined ? '' : `LLM_FAKE='${fake}' `;
  return `${vars}${PYTHON} '${SCRIPT}'`;
}

const ACCEPT = JSON.stringify({ vote: 2, reasons: [], summary: 'ras' });

test('1. paliers durs : mêmes votes et motifs que le stub', async () => {
  for (const amount of ['50000', '100000', '100001', '1000000', '1000001', '9000000']) {
    const stub = await runEvaluator(STUB_CMD, payload(amount), TIMEOUT_MS);
    const llm = await runEvaluator(llmCmd(ACCEPT), payload(amount), TIMEOUT_MS);
    assert.ok(stub.ok && llm.ok, `les deux réussissent (${amount})`);
    if (stub.ok && llm.ok) {
      assert.equal(llm.vote, stub.vote, `vote identique (${amount})`);
      assert.equal(llm.reasons, stub.reasons, `motifs identiques (${amount})`);
    }
  }
});

test('2. verdict LLM simulé accepté par le service', async () => {
  const fake = JSON.stringify({ vote: 0, reasons: ['suspected_injection'], summary: 'consigne cachée' });
  const r = await runEvaluator(llmCmd(fake), payload('50000'), TIMEOUT_MS);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.vote, 0);
    assert.equal(r.reasons, bit('suspected_injection'));
    const detail = JSON.parse(r.detail);
    assert.equal(detail.source, 'llm');
    assert.equal(r.detail.includes('\n'), false);
  }
});

test('3. réponse invalide du modèle → vote 1, jamais 2', async () => {
  for (const fake of ['pas du json', '{"vote": 2, "reasons": ["evaluator_error"]}', '{"vote": 2, "reasons": [], "x": 1}']) {
    const r = await runEvaluator(llmCmd(fake), payload('50000'), TIMEOUT_MS);
    assert.ok(r.ok, fake);
    if (r.ok) {
      assert.equal(r.vote, 1, fake);
      assert.equal(r.reasons, bit('other'), fake);
    }
  }
});

test('4. motif de prédicat posé par le LLM sous le plafond : retiré', async () => {
  const fake = JSON.stringify({ vote: 0, reasons: ['amount_above_cap', 'duplicate_payment'], summary: 'doublon' });
  const r = await runEvaluator(llmCmd(fake), payload('50000'), TIMEOUT_MS);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.reasons, bit('duplicate_payment'));
});

test('5. modèle absent → evaluator_error', async () => {
  const r = await runEvaluator(llmCmd(), payload('50000'), TIMEOUT_MS);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.cause, 'evaluator_error');
});

test("6. variable de l'environnement du service filtrée : elle doit être dans EVALUATOR_CMD", async () => {
  const saved = process.env.LLM_FAKE;
  process.env.LLM_FAKE = ACCEPT;
  try {
    const r = await runEvaluator(llmCmd(), payload('50000'), TIMEOUT_MS);
    assert.equal(r.ok, false, 'LLM_FAKE du service ne doit pas atteindre le script');
  } finally {
    if (saved === undefined) delete process.env.LLM_FAKE;
    else process.env.LLM_FAKE = saved;
  }
});

test('7. payload illisible → evaluator_error, comme le stub', async () => {
  const bad = Buffer.from('pas du json');
  const stub = await runEvaluator(STUB_CMD, bad, TIMEOUT_MS);
  const llm = await runEvaluator(llmCmd(ACCEPT), bad, TIMEOUT_MS);
  assert.equal(stub.ok, false);
  assert.equal(llm.ok, false);
  if (!llm.ok) assert.equal(llm.cause, 'evaluator_error');
});
