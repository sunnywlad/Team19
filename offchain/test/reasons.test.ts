// test/reasons.test.ts -- tests de reasonsToMask et maskToReasons
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reasonsToMask, maskToReasons, REASON_BITS, SCRIPT_REASONS, SERVICE_REASONS } from '../lib/reasons.ts';

describe('reasonsToMask', () => {
  it('liste vide -> 0', () => {
    assert.equal(reasonsToMask([]), 0);
  });

  it('amount_above_cap -> bit 0 -> 1', () => {
    assert.equal(reasonsToMask(['amount_above_cap']), 1);
  });

  it('beneficiary_not_allowed -> bit 1 -> 2', () => {
    assert.equal(reasonsToMask(['beneficiary_not_allowed']), 2);
  });

  it('other -> bit 15 -> 32768', () => {
    assert.equal(reasonsToMask(['other']), 32768);
  });

  it('combinaison : amount_above_cap + beneficiary_not_allowed -> 3', () => {
    assert.equal(reasonsToMask(['amount_above_cap', 'beneficiary_not_allowed']), 3);
  });

  it('motif inconnu -> erreur', () => {
    assert.throws(() => reasonsToMask(['unknown_reason']), /inconnu/i);
  });

  it('tous les motifs connus -> pas erreur', () => {
    const all = Object.keys(REASON_BITS);
    assert.doesNotThrow(() => reasonsToMask(all));
  });
});

describe('maskToReasons', () => {
  it('0 -> liste vide', () => {
    assert.deepEqual(maskToReasons(0), []);
  });

  it('1 -> ["amount_above_cap"]', () => {
    assert.deepEqual(maskToReasons(1), ['amount_above_cap']);
  });

  it('3 -> ["amount_above_cap", "beneficiary_not_allowed"]', () => {
    assert.deepEqual(maskToReasons(3), ['amount_above_cap', 'beneficiary_not_allowed']);
  });

  it('round-trip mask -> names -> mask', () => {
    const original = ['amount_above_cap', 'insufficient_context', 'other'];
    const mask = reasonsToMask(original);
    const names = maskToReasons(mask);
    assert.deepEqual(reasonsToMask(names), mask);
  });
});

describe('SCRIPT_REASONS / SERVICE_REASONS', () => {
  it('content_mismatch est un motif de service, pas de script', () => {
    assert(!SCRIPT_REASONS.has('content_mismatch'));
    assert(SERVICE_REASONS.has('content_mismatch'));
  });

  it('amount_above_cap est un motif de script, pas de service', () => {
    assert(SCRIPT_REASONS.has('amount_above_cap'));
    assert(!SERVICE_REASONS.has('amount_above_cap'));
  });

  it('tous les motifs de service ont un bit dans REASON_BITS', () => {
    for (const name of SERVICE_REASONS) {
      assert(name in REASON_BITS, `${name} manquant dans REASON_BITS`);
    }
  });
});
