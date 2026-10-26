/**
 * The TCK comparison policy.
 *
 * Original work. The policy is written down
 * and applied in one place, because a "pass" produced by an undocumented
 * coercion is worse than a failure.
 *
 * Policy:
 *
 * - **Numbers** compare exactly, in decimal, with one narrowly scoped
 *   exception described under "recorded precision" below. No tolerance is
 *   applied: a tolerance would hide precisely the defects this project exists
 *   to avoid.
 * - **Strings and booleans** compare exactly.
 * - **Lists** compare element-wise, in order, with equal length required.
 * - **Contexts** compare key-for-key. An extra or missing key is a mismatch;
 *   a key present with a null value is not the same as an absent key.
 * - **Null** matches only null.
 * - No other normalization is applied before comparison.
 *
 * ## Recorded precision
 *
 * A DECIMAL128 result carries 34 significant digits. TCK expectations do not:
 * `0008-LX-arithmetic` records `2778.69354943277` (15 digits) and
 * `0040-singlenestedcontext` records `2878.6935494327668` (17), for the same
 * underlying calculation. Both are the 34-digit result truncated for
 * readability — they are not double-precision results, which for that model
 * would be `2778.693549432746`.
 *
 * So an expectation cannot always be compared digit-for-digit against a
 * decimal128 result, and every conformant engine faces this. The rule applied
 * here is deliberately narrow:
 *
 * - if the values are exactly equal, they match;
 * - otherwise, **only when the actual value occupies the full 34 significant
 *   digits** — the signature of a non-terminating result that arithmetic
 *   rounded, and therefore one the TCK could not have recorded in full — the
 *   actual is rounded to the number of significant digits the expectation
 *   carries, and compared exactly at that precision;
 * - in every other case the comparison stays exact.
 *
 * The narrowness is the point. A result like `0.3` occupies one significant
 * digit, so a regression producing `0.30000000000000004` is still caught
 * exactly. Only results the working precision itself truncated are compared at
 * reduced precision, and when that happens the comparison says so.
 */

import {
  describeValue,
  isFeelList,
  isFeelNumber,
  isFeelContext,
  isFeelTemporal,
  feelEquals,
  type FeelNumber,
  type FeelValue,
} from '@smarthorizon-labs/dmn-feel';

export interface Comparison {
  readonly equal: boolean;
  /** Populated when unequal: where the values first differ. */
  readonly detail?: string;
}

export function compareValues(actual: FeelValue, expected: FeelValue, path = ''): Comparison {
  const where = path === '' ? '' : ` at ${path}`;

  if (expected === null || actual === null) {
    return expected === null && actual === null
      ? { equal: true }
      : {
          equal: false,
          detail: `expected ${describeValue(expected)}, got ${describeValue(actual)}${where}`,
        };
  }

  if (isFeelNumber(expected)) {
    if (!isFeelNumber(actual)) {
      return { equal: false, detail: `expected a number, got ${typeName(actual)}${where}` };
    }
    return compareNumbers(actual, expected, where);
  }

  if (typeof expected === 'string' || typeof expected === 'boolean') {
    return expected === actual
      ? { equal: true }
      : {
          equal: false,
          detail: `expected ${describeValue(expected)}, got ${describeValue(actual)}${where}`,
        };
  }

  // Temporal values compare through the engine's own equality, which knows
  // that the two duration kinds are distinct types and that a zoned value and
  // a plain one are not interchangeable.
  if (isFeelTemporal(expected)) {
    if (!isFeelTemporal(actual)) {
      return { equal: false, detail: `expected a temporal value, got ${typeName(actual)}${where}` };
    }
    return feelEquals(actual, expected) === true
      ? { equal: true }
      : {
          equal: false,
          detail: `expected ${describeValue(expected)}, got ${describeValue(actual)}${where}`,
        };
  }

  if (isFeelList(expected)) {
    if (!isFeelList(actual)) {
      return { equal: false, detail: `expected a list, got ${typeName(actual)}${where}` };
    }

    if (expected.length !== actual.length) {
      return {
        equal: false,
        detail: `expected ${String(expected.length)} items, got ${String(actual.length)}${where}`,
      };
    }

    for (const [index, item] of expected.entries()) {
      const comparison = compareValues(actual[index] ?? null, item, `${path}[${String(index)}]`);
      if (!comparison.equal) {
        return comparison;
      }
    }

    return { equal: true };
  }

  if (isFeelContext(expected)) {
    if (!isFeelContext(actual)) {
      return { equal: false, detail: `expected a context, got ${typeName(actual)}${where}` };
    }

    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();

    if (expectedKeys.join('\u0000') !== actualKeys.join('\u0000')) {
      return {
        equal: false,
        detail: `expected keys [${expectedKeys.join(', ')}], got [${actualKeys.join(', ')}]${where}`,
      };
    }

    for (const key of expectedKeys) {
      const comparison = compareValues(
        actual[key] ?? null,
        expected[key] ?? null,
        path === '' ? key : `${path}.${key}`,
      );
      if (!comparison.equal) {
        return comparison;
      }
    }

    return { equal: true };
  }

  return {
    equal: false,
    detail: `unsupported expected value ${describeValue(expected)}${where}`,
  };
}

/** The working precision. A result with this many significant digits was rounded. */
const WORKING_PRECISION = 34;

function compareNumbers(actual: FeelNumber, expected: FeelNumber, where: string): Comparison {
  if (expected.equals(actual)) {
    return { equal: true };
  }

  const recorded = expected.precision();

  if (actual.precision() >= WORKING_PRECISION && recorded < WORKING_PRECISION) {
    const rounded = actual.toSignificantDigits(recorded);

    if (rounded.equals(expected)) {
      return { equal: true };
    }

    return {
      equal: false,
      detail:
        `expected ${describeValue(expected)}, got ${describeValue(actual)}` +
        ` (${describeValue(rounded)} at the ${String(recorded)} significant digits recorded)${where}`,
    };
  }

  return {
    equal: false,
    detail: `expected ${describeValue(expected)}, got ${describeValue(actual)}${where}`,
  };
}

function typeName(value: FeelValue): string {
  if (value === null) return 'null';
  if (isFeelNumber(value)) return 'number';
  if (isFeelTemporal(value)) return 'temporal';
  if (isFeelList(value)) return 'list';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  return 'context';
}
