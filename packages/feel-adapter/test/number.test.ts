/**
 * Numeric semantics: MathContext.DECIMAL128.
 *
 * These are the cases that motivated owning the evaluator (ADR-0001).
 * Expected values are the arithmetic results the reference engines
 * produce; the differential harness verifies that claim against Drools rather
 * than taking it on trust.
 */

import { describe, expect, it } from 'vitest';

import { FeelDecimal, arithmetic, feelNumberToString, toFeelNumber } from '../src/number.js';

function number(literal: string) {
  const value = toFeelNumber(literal);
  if (value === null) {
    throw new Error(`expected ${literal} to be a FEEL number`);
  }
  return value;
}

describe('decimal arithmetic', () => {
  it('adds tenths exactly', () => {
    // The canonical binary floating-point failure: 0.1 + 0.2 === 0.30000000000000004.
    expect(feelNumberToString(number('0.1').plus(number('0.2')))).toBe('0.3');
  });

  it('reproduces the case reported against feelin as issue #109', () => {
    // 1.1 + 1.3 evaluates to 2.4000000000000004 under binary doubles.
    expect(feelNumberToString(number('1.1').plus(number('1.3')))).toBe('2.4');
  });

  it('accumulates monetary amounts without drift', () => {
    let total = number('0');
    for (let index = 0; index < 10; index++) {
      total = total.plus(number('0.1'));
    }
    expect(feelNumberToString(total)).toBe('1');
  });

  it('keeps cents exact across a percentage calculation', () => {
    const amount = number('280000.15');
    const rate = number('0.0725');
    expect(feelNumberToString(amount.times(rate))).toBe('20300.010875');
  });
});

describe('precision and rounding', () => {
  it('carries 34 significant digits', () => {
    const third = arithmetic('/', number('1'), number('3'));
    expect(third).not.toBeNull();
    expect(feelNumberToString(third!)).toBe(`0.${'3'.repeat(34)}`);
  });

  it('rounds half to even, downwards, when the retained digit is even', () => {
    // 35 significant digits; dropping the final 5 is an exact tie.
    const tie = number(`1.${'0'.repeat(33)}5`);
    expect(feelNumberToString(tie.plus(0))).toBe('1');
  });

  it('rounds half to even, upwards, when the retained digit is odd', () => {
    const tie = number(`1.${'0'.repeat(32)}15`);
    expect(feelNumberToString(tie.plus(0))).toBe(`1.${'0'.repeat(32)}2`);
  });

  it('does not round below 34 significant digits', () => {
    const exact = number(`1.${'2'.repeat(33)}`);
    expect(feelNumberToString(exact.plus(0))).toBe(`1.${'2'.repeat(33)}`);
  });
});

describe('exponent range', () => {
  it('accepts magnitudes beyond binary double range', () => {
    // The exponent is unbounded, matching
    // MathContext.DECIMAL128 rather than strict IEEE decimal128.
    const large = arithmetic('*', number('2e400'), number('4e400'));
    expect(large).not.toBeNull();
    // Number.MAX_VALUE is ~1.8e308, so this product has no double equivalent.
    expect(large!.toExponential(0)).toBe('8e+800');
  });
});

describe('invalid results are null, never NaN or infinity', () => {
  it('returns null for division by zero', () => {
    expect(arithmetic('/', number('1'), number('0'))).toBeNull();
  });

  it('returns null for unparseable input', () => {
    expect(toFeelNumber('twelve')).toBeNull();
    expect(toFeelNumber('')).toBeNull();
  });

  it('returns null for non-finite host numbers', () => {
    expect(toFeelNumber(Number.NaN)).toBeNull();
    expect(toFeelNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('configuration isolation', () => {
  it('does not mutate the shared decimal.js constructor', async () => {
    // A library that reconfigures the host application's
    // decimal settings would be a defect.
    const { Decimal } = await import('decimal.js');
    expect(Decimal.precision).not.toBe(FeelDecimal.precision);
    expect(FeelDecimal.precision).toBe(34);
    expect(FeelDecimal.rounding).toBe(Decimal.ROUND_HALF_EVEN);
  });
});
