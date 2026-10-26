/**
 * The value interchange format for differential testing.
 *
 * Original work. Two engines in different languages have to exchange DMN values
 * without either one's type system distorting them, so the format is explicit
 * about type rather than relying on JSON's.
 *
 * Numbers travel as **strings**. A JSON number is an IEEE-754 double, and
 * sending a 34-digit decimal through one would corrupt exactly the values this
 * harness exists to compare.
 *
 * Temporal values travel in their ISO 8601 lexical form. This runtime cannot
 * evaluate them yet, but Drools can, so they are carried through rather than
 * discarded — the recorded reference values are useful before the feature that
 * consumes them exists.
 */

import {
  describeValue,
  isFeelList,
  isFeelNumber,
  isFeelContext,
  isFeelTemporal,
  parseDate,
  parseDateTime,
  parseDuration,
  parseTime,
  temporalToString,
  temporalTypeOf,
  toFeelNumber,
} from '@smarthorizon-labs/dmn-feel';
import type { FeelValue } from '@smarthorizon-labs/dmn-feel';

export type WireValue =
  | { readonly type: 'null' }
  | { readonly type: 'boolean'; readonly value: boolean }
  | { readonly type: 'number'; readonly value: string }
  | { readonly type: 'string'; readonly value: string }
  | { readonly type: 'date'; readonly value: string }
  | { readonly type: 'time'; readonly value: string }
  | { readonly type: 'dateTime'; readonly value: string }
  | { readonly type: 'duration'; readonly value: string }
  | { readonly type: 'list'; readonly items: readonly WireValue[] }
  | { readonly type: 'context'; readonly entries: Readonly<Record<string, WireValue>> }
  /** The engine reported a failure for this decision. */
  | { readonly type: 'error'; readonly message: string }
  /** The engine produced something this format cannot express. */
  | { readonly type: 'unsupported'; readonly detail: string };

/** Types this runtime cannot yet turn into a FEEL value. */
export const TEMPORAL_TYPES = new Set(['date', 'time', 'dateTime', 'duration']);

/** Marks a wire value this runtime cannot represent. */
export const UNREPRESENTABLE = Symbol('unrepresentable');

export type DecodedValue = FeelValue | typeof UNREPRESENTABLE;

export function decodeWire(wire: WireValue): DecodedValue {
  switch (wire.type) {
    case 'null':
      return null;

    case 'boolean':
      return wire.value;

    case 'string':
      return wire.value;

    case 'number':
      return toFeelNumber(wire.value);

    // Temporal values are now representable, so they decode rather than
    // marking the whole case unusable.
    case 'date':
      return parseDate(wire.value);

    case 'time':
      return parseTime(wire.value);

    case 'dateTime':
      return parseDateTime(wire.value);

    case 'duration':
      return parseDuration(wire.value);

    case 'list': {
      const items: FeelValue[] = [];
      for (const item of wire.items) {
        const decoded = decodeWire(item);
        if (decoded === UNREPRESENTABLE) {
          return UNREPRESENTABLE;
        }
        items.push(decoded);
      }
      return items;
    }

    case 'context': {
      const entries: Record<string, FeelValue> = Object.create(null) as Record<
        string,
        FeelValue
      >;
      for (const [key, value] of Object.entries(wire.entries)) {
        const decoded = decodeWire(value);
        if (decoded === UNREPRESENTABLE) {
          return UNREPRESENTABLE;
        }
        entries[key] = decoded;
      }
      return entries;
    }

    default:
      return UNREPRESENTABLE;
  }
}

export function encodeFeel(value: FeelValue): WireValue {
  if (value === null) {
    return { type: 'null' };
  }

  if (typeof value === 'boolean') {
    return { type: 'boolean', value };
  }

  if (typeof value === 'string') {
    return { type: 'string', value };
  }

  if (isFeelNumber(value)) {
    return { type: 'number', value: value.toFixed() };
  }

  if (isFeelTemporal(value)) {
    const type = temporalTypeOf(value);
    const wireType =
      type === 'date' || type === 'time'
        ? type
        : type === 'date and time'
          ? 'dateTime'
          : 'duration';
    return { type: wireType, value: temporalToString(value) };
  }

  if (isFeelList(value)) {
    return { type: 'list', items: value.map(encodeFeel) };
  }

  if (isFeelContext(value)) {
    const entries: Record<string, WireValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      entries[key] = encodeFeel(entry ?? null);
    }
    return { type: 'context', entries };
  }

  return { type: 'unsupported', detail: describeValue(value) };
}

/** A short, stable rendering used in divergence reports. */
export function describeWire(wire: WireValue): string {
  switch (wire.type) {
    case 'null':
      return 'null';
    case 'boolean':
      return String(wire.value);
    case 'number':
      return wire.value;
    case 'string':
      return JSON.stringify(wire.value);
    case 'date':
    case 'time':
    case 'dateTime':
    case 'duration':
      return `${wire.type}("${wire.value}")`;
    case 'list':
      return `[${wire.items.map(describeWire).join(', ')}]`;
    case 'context':
      return `{${Object.entries(wire.entries)
        .map(([key, value]) => `${key}: ${describeWire(value)}`)
        .join(', ')}}`;
    case 'error':
      return `error(${wire.message})`;
    case 'unsupported':
      return `unsupported(${wire.detail})`;
  }
}

/**
 * How numbers are compared.
 *
 * `exact` compares two engines' outputs, which are both full precision, so any
 * difference is a real difference. `recorded` compares an engine's output
 * against a TCK expectation, which may have been written down with fewer
 * digits than DECIMAL128 carries — the same narrow allowance `compare.ts`
 * documents, and for the same reason.
 */
export type NumberPolicy = 'exact' | 'recorded';

const WORKING_PRECISION = 34;

/**
 * Structural equality over wire values.
 *
 * Numbers compare as decimals, not as strings, so `1.50` and `1.5` agree.
 */
export function wireEquals(
  left: WireValue,
  right: WireValue,
  numbers: NumberPolicy = 'exact',
): boolean {
  if (left.type !== right.type) {
    return false;
  }

  switch (left.type) {
    case 'null':
      return true;

    case 'number':
      return numbersEqual(left.value, (right as { value: string }).value, numbers);

    case 'boolean':
    case 'string':
    case 'date':
    case 'time':
    case 'dateTime':
    case 'duration':
      return left.value === (right as { value: unknown }).value;

    case 'list': {
      const other = right as Extract<WireValue, { type: 'list' }>;
      return (
        left.items.length === other.items.length &&
        left.items.every((item, index) =>
          wireEquals(item, other.items[index] as WireValue, numbers),
        )
      );
    }

    case 'context': {
      const other = right as Extract<WireValue, { type: 'context' }>;
      const leftKeys = Object.keys(left.entries).sort();
      const rightKeys = Object.keys(other.entries).sort();

      return (
        leftKeys.join(' ') === rightKeys.join(' ') &&
        leftKeys.every((key) =>
          wireEquals(left.entries[key] as WireValue, other.entries[key] as WireValue, numbers),
        )
      );
    }

    case 'error':
      // Two engines failing is agreement; the messages will never match.
      return true;

    case 'unsupported':
      return left.detail === (right as { detail: string }).detail;
  }
}

function numbersEqual(left: string, right: string, policy: NumberPolicy): boolean {
  const actual = toFeelNumber(left);
  const expected = toFeelNumber(right);

  if (actual === null || expected === null) {
    return left === right;
  }

  if (actual.equals(expected)) {
    return true;
  }

  if (policy === 'exact') {
    return false;
  }

  const recorded = expected.precision();

  return (
    actual.precision() >= WORKING_PRECISION &&
    recorded < WORKING_PRECISION &&
    actual.toSignificantDigits(recorded).equals(expected)
  );
}
