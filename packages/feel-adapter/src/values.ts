/**
 * The FEEL value model.
 *
 * Original work. The runtime does not use raw
 * JavaScript types as its semantic model: a FEEL number is a decimal, and FEEL
 * `null` is a value rather than an absence.
 *
 * Temporal types are declared here but not yet evaluable; see
 * `UNSUPPORTED_CONSTRUCTS` in `evaluate.ts`. Returning an explicit "unsupported"
 * diagnostic is preferred over returning a plausible wrong answer.
 */

import { type FeelNumber, isFeelNumber, feelNumberToString } from './number.js';
import {
  compareTemporal,
  isFeelTemporal,
  temporalToString,
  temporalTypeOf,
  type FeelTemporal,
} from './temporal.js';

/** A FEEL context: an ordered map from name to value. */
export type FeelContext = { readonly [key: string]: FeelValue };

/** A closed or half-open range over comparable values. */
export interface FeelRange {
  readonly kind: 'range';
  readonly start: FeelValue;
  readonly end: FeelValue;
  readonly startIncluded: boolean;
  readonly endIncluded: boolean;
}

/**
 * A callable FEEL value: a business knowledge model, a boxed function
 * definition, or a registered safe function.
 *
 * Invocation is positional. Named arguments are resolved against
 * {@link FeelFunction.parameters} at the call site, so a callee never has to
 * know which syntax invoked it.
 */
export interface FeelFunction {
  readonly kind: 'function';
  readonly name?: string;
  readonly parameters: readonly string[];
  invoke(args: readonly FeelValue[]): FeelValue;
}

export type FeelValue =
  | null
  | boolean
  | string
  | FeelNumber
  | FeelRange
  | FeelFunction
  | FeelTemporal
  | readonly FeelValue[]
  | FeelContext;

export function isFeelRange(value: unknown): value is FeelRange {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'range'
  );
}

export function isFeelFunction(value: unknown): value is FeelFunction {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'function'
  );
}

export function isFeelList(value: unknown): value is readonly FeelValue[] {
  return Array.isArray(value);
}

export function isFeelContext(value: unknown): value is FeelContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !isFeelNumber(value) &&
    !isFeelRange(value) &&
    !isFeelFunction(value) &&
    !isFeelTemporal(value)
  );
}

/**
 * The FEEL type name of a value, as used in diagnostics and by `type name()`.
 */
export function feelTypeOf(value: FeelValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  if (isFeelNumber(value)) return 'number';
  if (isFeelRange(value)) return 'range';
  if (isFeelFunction(value)) return 'function';
  if (isFeelTemporal(value)) return temporalTypeOf(value);
  if (isFeelList(value)) return 'list';
  return 'context';
}

/**
 * FEEL equality — three-valued.
 *
 * Verified against Drools 10.2.0 and DMN TCK `0068-feel-equality`, whose cases
 * pin every branch:
 *
 * - `null = null` is `true`, and `100 = null` is `false`. A comparison
 *   involving null is decided, never null itself.
 * - `100 = "100"`, `true = 1` and `[] = 0` are **null**, not false. Values of
 *   different types are not unequal; they are incomparable, and saying `false`
 *   claims knowledge the engine does not have.
 * - Values of the same type compare structurally.
 *
 * The distinction matters downstream: a decision-table input entry that cannot
 * be decided must not silently read as "no match".
 */
export function feelEquals(left: FeelValue, right: FeelValue): boolean | null {
  if (left === null || right === null) {
    return left === null && right === null;
  }

  // Each branch establishes the left type once and rejects a mismatched right
  // as null. Deriving both type names up front would read better and costs
  // measurably more: equality is the hottest path in decision-table matching.
  if (isFeelNumber(left)) {
    return isFeelNumber(right) ? left.equals(right) : null;
  }

  if (typeof left === 'boolean') {
    return typeof right === 'boolean' ? left === right : null;
  }

  if (typeof left === 'string') {
    return typeof right === 'string' ? left === right : null;
  }

  if (isFeelList(left)) {
    if (!isFeelList(right)) {
      return null;
    }

    if (left.length !== right.length) {
      return false;
    }

    // First non-true element decides, in order: a definite mismatch outranks a
    // later undecidable one.
    for (const [index, item] of left.entries()) {
      const equal = feelEquals(item, right[index] ?? null);
      if (equal !== true) {
        return equal;
      }
    }

    return true;
  }

  if (isFeelFunction(left)) {
    // Functions are not comparable in FEEL, not even to themselves.
    return null;
  }

  if (isFeelTemporal(left)) {
    if (!isFeelTemporal(right)) {
      return null;
    }
    const ordering = compareTemporal(left, right);
    return ordering === null ? null : ordering === 0;
  }

  if (isFeelRange(left)) {
    if (!isFeelRange(right)) {
      return null;
    }
    if (left.startIncluded !== right.startIncluded || left.endIncluded !== right.endIncluded) {
      return false;
    }
    const start = feelEquals(left.start, right.start);
    return start === true ? feelEquals(left.end, right.end) : start;
  }

  if (isFeelContext(left)) {
    if (!isFeelContext(right)) {
      return null;
    }

    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();

    if (leftKeys.join('\u0000') !== rightKeys.join('\u0000')) {
      return false;
    }

    for (const key of leftKeys) {
      const equal = feelEquals(left[key] ?? null, right[key] ?? null);
      if (equal !== true) {
        return equal;
      }
    }

    return true;
  }

  return null;
}

/** `!=`, which is `not(=)` and therefore null-preserving. */
export function feelNotEquals(left: FeelValue, right: FeelValue): boolean | null {
  const equal = feelEquals(left, right);
  return equal === null ? null : !equal;
}

/**
 * Ordering for the `<`, `<=`, `>` and `>=` operators.
 *
 * Returns `null` when the values are not mutually comparable, which the caller
 * turns into a FEEL `null` result rather than an error.
 */
export function feelCompare(left: FeelValue, right: FeelValue): number | null {
  if (isFeelNumber(left) && isFeelNumber(right)) {
    return left.comparedTo(right);
  }

  if (isFeelTemporal(left) && isFeelTemporal(right)) {
    return compareTemporal(left, right);
  }

  if (typeof left === 'string' && typeof right === 'string') {
    // Code-unit ordering, matching the reference engines' use of the host
    // string comparison rather than a locale-aware collation.
    if (left === right) return 0;
    return left < right ? -1 : 1;
  }

  return null;
}

/** Renders a value for diagnostics. Not the FEEL `string()` built-in. */
export function describeValue(value: FeelValue): string {
  if (value === null) return 'null';
  if (isFeelNumber(value)) return feelNumberToString(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return String(value);
  if (isFeelFunction(value)) return `function ${value.name ?? '(anonymous)'}`;
  if (isFeelTemporal(value)) return temporalToString(value);
  if (isFeelList(value)) return `[${value.map(describeValue).join(', ')}]`;
  if (isFeelRange(value)) {
    const open = value.startIncluded ? '[' : '(';
    const close = value.endIncluded ? ']' : ')';
    return `${open}${describeValue(value.start)}..${describeValue(value.end)}${close}`;
  }
  return `{${Object.entries(value)
    .map(([key, entry]) => `${key}: ${describeValue(entry)}`)
    .join(', ')}}`;
}
