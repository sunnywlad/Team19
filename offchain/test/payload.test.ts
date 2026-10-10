// test/payload.test.ts -- tests de validatePayload et deriveFacts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePayload, deriveFacts } from '../lib/payload.ts';

// --- Fixture ---

const VALID = {
  schemaVersion: 1,
  requester: '0xabcdef1234567890abcdef1234567890abcdef12',
  agentId: 'agent-001',
  prompt: 'Pay the invoice',
  context: { invoice: 'INV-001' },
  plannedDecision: {
    action: 'pay',
    amountMinor: '123456',
    currency: 'EUR',
    beneficiaryId: 'FR7612345987650123456789014',
    reference: 'INV-001',
  },
  createdAt: 1700000000,
  salt: '0x' + 'ab'.repeat(32),
};

function buf(obj: unknown): Buffer {
  return Buffer.from(JSON.stringify(obj));
}

// --- validatePayload ---

describe('validatePayload', () => {
  it('accepte un payload valide', () => {
    const p = validatePayload(buf(VALID));
    assert.equal(p.schemaVersion, 1);
    assert.equal(p.requester, VALID.requester);
    assert.equal(p.plannedDecision.amountMinor, '123456');
  });

  it('rejette un payload non UTF-8', () => {
    const bad = Buffer.from([0x80, 0x81]);
    assert.throws(() => validatePayload(bad), /UTF-8/i);
  });

  it('rejette JSON invalide', () => {
    assert.throws(() => validatePayload(Buffer.from('not json')), /JSON/i);
  });

  it('rejette un schemaVersion != 1', () => {
    assert.throws(() => validatePayload(buf({ ...VALID, schemaVersion: 2 })), /schemaVersion/);
  });

  it('rejette un requester en majuscules', () => {
    assert.throws(
      () => validatePayload(buf({ ...VALID, requester: '0xABCDEF1234567890ABCDEF1234567890ABCDEF12' })),
      /requester/,
    );
  });

  it('rejette un requester sans 0x', () => {
    assert.throws(
      () => validatePayload(buf({ ...VALID, requester: 'abcdef1234567890abcdef1234567890abcdef12' })),
      /requester/,
    );
  });

  it('rejette amountMinor avec signe negatif', () => {
    assert.throws(
      () => validatePayload(buf({ ...VALID, plannedDecision: { ...VALID.plannedDecision, amountMinor: '-1' } })),
      /amountMinor/,
    );
  });

  it('rejette amountMinor avec zeros en tete', () => {
    assert.throws(
      () => validatePayload(buf({ ...VALID, plannedDecision: { ...VALID.plannedDecision, amountMinor: '007' } })),
      /amountMinor/,
    );
  });

  it('accepte amountMinor = "0"', () => {
    const p = validatePayload(buf({ ...VALID, plannedDecision: { ...VALID.plannedDecision, amountMinor: '0' } }));
    assert.equal(p.plannedDecision.amountMinor, '0');
  });

  it('rejette currency minuscule', () => {
    assert.throws(
      () => validatePayload(buf({ ...VALID, plannedDecision: { ...VALID.plannedDecision, currency: 'eur' } })),
      /currency/,
    );
  });

  it('rejette currency de 4 lettres', () => {
    assert.throws(
      () => validatePayload(buf({ ...VALID, plannedDecision: { ...VALID.plannedDecision, currency: 'EURO' } })),
      /currency/,
    );
  });

  it('rejette beneficiaryId vide', () => {
    assert.throws(
      () => validatePayload(buf({ ...VALID, plannedDecision: { ...VALID.plannedDecision, beneficiaryId: '' } })),
      /beneficiaryId/,
    );
  });

  it('rejette beneficiaryId avec espaces', () => {
    assert.throws(
      () => validatePayload(buf({ ...VALID, plannedDecision: { ...VALID.plannedDecision, beneficiaryId: 'FR76 1234' } })),
      /beneficiaryId/,
    );
  });

  it('accepte reference vide', () => {
    const p = validatePayload(buf({ ...VALID, plannedDecision: { ...VALID.plannedDecision, reference: '' } }));
    assert.equal(p.plannedDecision.reference, '');
  });

  it('rejette un champ inconnu a la racine', () => {
    assert.throws(() => validatePayload(buf({ ...VALID, extra: 'oops' })), /inconnu/i);
  });

  it('rejette un champ inconnu dans plannedDecision', () => {
    assert.throws(
      () => validatePayload(buf({ ...VALID, plannedDecision: { ...VALID.plannedDecision, extra: 'x' } })),
      /inconnu/i,
    );
  });

  it('rejette un champ manquant a la racine', () => {
    const { salt: _salt, ...noSalt } = VALID;
    assert.throws(() => validatePayload(buf(noSalt)), /manquant/i);
  });

  it('rejette context tableau', () => {
    assert.throws(() => validatePayload(buf({ ...VALID, context: [1, 2] })), /context/);
  });

  it('rejette salt trop court', () => {
    assert.throws(() => validatePayload(buf({ ...VALID, salt: '0x' + 'ab'.repeat(16) })), /salt/);
  });

  it('rejette createdAt negatif', () => {
    assert.throws(() => validatePayload(buf({ ...VALID, createdAt: -1 })), /createdAt/);
  });
});

// --- deriveFacts ---

describe('deriveFacts', () => {
  it('derive correctement les facts', () => {
    const payload = validatePayload(buf(VALID));
    const facts = deriveFacts(payload);

    assert.equal(facts.amount, 123456n);
    // EUR en ASCII = 0x455552
    assert.equal(facts.currency.toLowerCase(), '0x455552');
    assert(facts.beneficiaryId.startsWith('0x'));
    assert.equal(facts.beneficiaryId.length, 66);
    assert(facts.referenceId.startsWith('0x'));
    assert.equal(facts.referenceId.length, 66);
  });

  it('referenceId = 0x00x32 si reference vide', () => {
    const payload = validatePayload(buf({
      ...VALID,
      plannedDecision: { ...VALID.plannedDecision, reference: '' },
    }));
    const facts = deriveFacts(payload);
    assert.equal(facts.referenceId, '0x' + '00'.repeat(32));
  });

  it('currency CHF = 0x434846', () => {
    const payload = validatePayload(buf({
      ...VALID,
      plannedDecision: { ...VALID.plannedDecision, currency: 'CHF' },
    }));
    const facts = deriveFacts(payload);
    assert.equal(facts.currency.toLowerCase(), '0x434846');
  });
});
