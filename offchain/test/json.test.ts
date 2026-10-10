// test/json.test.ts — tests unitaires de lib/json.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stringify } from '../lib/json.ts';

describe('stringify', () => {
  it('sérialise un objet sans bigint comme JSON.stringify standard', () => {
    const obj = { a: 1, b: 'hello', c: true, d: null };
    assert.equal(stringify(obj), JSON.stringify(obj));
  });

  it('sérialise un bigint en chaîne décimale', () => {
    const obj = { amount: 123456789012345678901234567890n };
    const result = JSON.parse(stringify(obj));
    assert.equal(result.amount, '123456789012345678901234567890');
  });

  it('sérialise un tableau avec bigint', () => {
    const result = JSON.parse(stringify([1n, 2n, 3n]));
    assert.deepEqual(result, ['1', '2', '3']);
  });

  it('bigint zéro → "0"', () => {
    const result = JSON.parse(stringify({ v: 0n }));
    assert.equal(result.v, '0');
  });

  it('bigint négatif → chaîne négative', () => {
    const result = JSON.parse(stringify({ v: -42n }));
    assert.equal(result.v, '-42');
  });

  it('objet imbriqué avec bigint', () => {
    const obj = { outer: { inner: 999999999999999999999n } };
    const result = JSON.parse(stringify(obj));
    assert.equal(result.outer.inner, '999999999999999999999');
  });

  it('valeurs non-bigint inchangées', () => {
    const obj = { n: 42, s: 'hello', b: false, nil: null };
    const result = JSON.parse(stringify(obj));
    assert.equal(result.n, 42);
    assert.equal(result.s, 'hello');
    assert.equal(result.b, false);
    assert.equal(result.nil, null);
  });
});
