/**
 * FEEL numeric semantics.
 *
 * Original work. Implements the numeric model decided in ADR-0001:
 * `java.math.MathContext.DECIMAL128` — 34 significant decimal digits,
 * `HALF_EVEN` rounding, unbounded decimal exponent.
 *
 * This replicates Drools, jDMN, Trisotech, IBM BAMOE and Camunda FEEL-Scala.
 * It deliberately does not replicate strict IEEE 754-2008 decimal128, which
 * bounds the exponent near 10^±6144; ADR-0001 records the deviation.
 */

import { Decimal } from 'decimal.js';

/**
 * The decimal constructor used for every FEEL number.
 *
 * Obtained via `clone()` rather than `Decimal.set()` so that configuring this
 * library never mutates the decimal settings of a host application that also
 * uses decimal.js.
 */
export const FeelDecimal = Decimal.clone({
  // MathContext.DECIMAL128 precision.
  precision: 34,
  // MathContext.DECIMAL128 rounding: banker's rounding.
  rounding: Decimal.ROUND_HALF_EVEN,
  // Never format as exponential in either direction; FEEL string conversion
  // is defined separately and should not inherit decimal.js display defaults.
  toExpNeg: -9e15,
  toExpPos: 9e15,
  // decimal.js maxima. The exponent is effectively unbounded, which is the
  // MathContext.DECIMAL128 behaviour rather than the strict IEEE one.
  minE: -9e15,
  maxE: 9e15,
});

export type FeelNumber = InstanceType<typeof FeelDecimal>;

/** True for values produced by {@link FeelDecimal}. */
export function isFeelNumber(value: unknown): value is FeelNumber {
  return value instanceof FeelDecimal;
}

/**
 * Builds a FEEL number, or returns null when the input does not denote one.
 *
 * FEEL has no NaN and no infinities: an invalid number is `null`
 * (DMN 1.5, and the Drools FEEL handbook). Callers therefore never receive a
 * non-finite value from this function.
 */
export function toFeelNumber(input: string | number | FeelNumber): FeelNumber | null {
  if (isFeelNumber(input)) {
    return input.isFinite() ? input : null;
  }

  if (typeof input === 'number') {
    // A JavaScript number is already binary, so any precision loss happened
    // before this call. Strings are the exact input path for monetary
    // values.
    if (!Number.isFinite(input)) {
      return null;
    }
    return new FeelDecimal(input);
  }

  const trimmed = input.trim();
  if (trimmed === '') {
    return null;
  }

  try {
    const value = new FeelDecimal(trimmed);
    return value.isFinite() ? value : null;
  } catch {
    return null;
  }
}

/**
 * Applies a binary arithmetic operation, mapping every failure to FEEL `null`.
 *
 * Division and modulo by zero are errors in decimal.js and `null` in FEEL, so
 * the guard is semantic rather than defensive.
 */
export function arithmetic(
  operator: '+' | '-' | '*' | '/' | '**',
  left: FeelNumber,
  right: FeelNumber,
): FeelNumber | null {
  try {
    let result: FeelNumber;

    switch (operator) {
      case '+':
        result = left.plus(right);
        break;
      case '-':
        result = left.minus(right);
        break;
      case '*':
        result = left.times(right);
        break;
      case '/':
        if (right.isZero()) {
          return null;
        }
        result = left.dividedBy(right);
        break;
      case '**':
        result = left.pow(right);
        break;
    }

    return result.isFinite() ? result : null;
  } catch {
    return null;
  }
}

/** Negation, preserving the null-on-invalid contract. */
export function negate(value: FeelNumber): FeelNumber | null {
  const result = value.negated();
  return result.isFinite() ? result : null;
}

/**
 * FEEL number-to-string conversion.
 *
 * Always plain notation, never exponential, and without a trailing `.0` for
 * integral values — the form the reference engines print.
 */
export function feelNumberToString(value: FeelNumber): string {
  return value.toFixed();
}
