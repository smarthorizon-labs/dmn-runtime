/**
 * The comparison policy is the part of a TCK runner most able to produce a
 * flattering result by accident, so it is tested directly.
 */

import { toFeelNumber, type FeelValue } from '@smarthorizon-labs/dmn-feel';
import { describe, expect, it } from 'vitest';

import { compareValues } from '../src/compare.js';

const number = (literal: string) => toFeelNumber(literal) as FeelValue;

describe('exact comparison', () => {
  it('matches identical values', () => {
    expect(compareValues(number('1.5'), number('1.5')).equal).toBe(true);
    expect(compareValues('a', 'a').equal).toBe(true);
    expect(compareValues(true, true).equal).toBe(true);
    expect(compareValues(null, null).equal).toBe(true);
  });

  it('treats trailing zeros as the same number', () => {
    expect(compareValues(number('1.50'), number('1.5')).equal).toBe(true);
  });

  it('rejects a type difference', () => {
    expect(compareValues('1', number('1')).equal).toBe(false);
    expect(compareValues(null, number('1')).equal).toBe(false);
  });
});

describe('recorded precision', () => {
  // The TCK records fewer digits than DECIMAL128 carries. Only a result that
  // occupies the full working precision may be compared at reduced precision.
  const fullPrecision = number('2778.693549432766768088520383236299');

  it('accepts an expectation that is the result truncated for readability', () => {
    // 0008-LX-arithmetic records 15 significant digits.
    expect(compareValues(fullPrecision, number('2778.69354943277')).equal).toBe(true);
  });

  it('accepts the same result recorded at a different precision', () => {
    // 0040-singlenestedcontext records 17 significant digits of the same value.
    const shifted = number('2878.693549432766768088520383236299');
    expect(compareValues(shifted, number('2878.6935494327668')).equal).toBe(true);
  });

  it('still rejects a genuinely different value at the recorded precision', () => {
    expect(compareValues(fullPrecision, number('2778.69354943299')).equal).toBe(false);
  });

  it('does NOT relax comparison for a result that fits well within precision', () => {
    // The guard that stops the policy hiding real defects: 0.3 occupies one
    // significant digit, so a floating-point-style error is still caught.
    const drifted = number('0.30000000000000004');
    expect(compareValues(drifted, number('0.3')).equal).toBe(false);
  });

  it('reports the reduced-precision value when it still does not match', () => {
    const comparison = compareValues(fullPrecision, number('2778.69354943299'));
    expect(comparison.detail).toContain('significant digits recorded');
  });
});

describe('structural comparison', () => {
  it('compares lists element-wise and in order', () => {
    expect(compareValues(['a', 'b'], ['a', 'b']).equal).toBe(true);
    expect(compareValues(['b', 'a'], ['a', 'b']).equal).toBe(false);
    expect(compareValues(['a'], ['a', 'b']).equal).toBe(false);
  });

  it('requires contexts to have exactly the same keys', () => {
    expect(compareValues({ a: 'x' }, { a: 'x' }).equal).toBe(true);
    expect(compareValues({ a: 'x', b: 'y' }, { a: 'x' }).equal).toBe(false);
    // A key present with a null value is not the same as an absent key.
    expect(compareValues({ a: null }, {}).equal).toBe(false);
  });

  it('points at where nested values first differ', () => {
    const comparison = compareValues({ a: { b: 'wrong' } }, { a: { b: 'right' } });
    expect(comparison.equal).toBe(false);
    expect(comparison.detail).toContain('a.b');
  });
});
