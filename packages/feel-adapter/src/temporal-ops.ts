/**
 * Temporal construction, arithmetic and property access.
 *
 * Original work. Kept separate from `temporal.ts` so that the value model has
 * no dependency on the operations, and from `values.ts` so that neither module
 * imports the other at runtime.
 *
 * Every operation returns FEEL `null` for a combination it cannot compute.
 * DMN has no arithmetic exceptions: `date("2024-01-01") + 1` is null, not an
 * error, and the caller decides whether that deserves a diagnostic.
 */

import { Temporal } from 'temporal-polyfill';

import { isFeelNumber, toFeelNumber, type FeelNumber } from './number.js';
import {
  duration,
  isFeelDuration,
  isPlainDate,
  isPlainDateTime,
  isPlainTime,
  isZoned,
  monthsOf,
  parseDate,
  parseDateTime,
  parseDuration,
  parseTime,
  secondsOf,
  type FeelDuration,
  type FeelTemporal,
} from './temporal.js';
import type { FeelValue } from './values.js';

/** Returned when a constructor name is not a temporal constructor at all. */
export const UNKNOWN_CONSTRUCTOR = Symbol('unknown temporal constructor');

const TEMPORAL_CONSTRUCTORS = new Set([
  'date',
  'time',
  'date and time',
  'duration',
  'years and months duration',
]);

export function isTemporalConstructor(name: string): boolean {
  return TEMPORAL_CONSTRUCTORS.has(name);
}

/**
 * Builds a temporal value from a constructor name and its arguments.
 *
 * Each constructor accepts the argument shapes DMN 1.5 defines: a lexical
 * string, component numbers, or another temporal value to convert from.
 */
export function constructTemporal(
  name: string,
  args: readonly FeelValue[],
): FeelValue | typeof UNKNOWN_CONSTRUCTOR {
  switch (name) {
    case 'date':
      return buildDate(args);
    case 'time':
      return buildTime(args);
    case 'date and time':
      return buildDateTime(args);
    case 'duration':
      return typeof args[0] === 'string' ? parseDuration(args[0]) : null;
    case 'years and months duration':
      return buildYearMonthDuration(args);
    default:
      return UNKNOWN_CONSTRUCTOR;
  }
}

function buildDate(args: readonly FeelValue[]): FeelValue {
  const [first, second, third] = args;

  if (typeof first === 'string' && args.length === 1) {
    return parseDate(first);
  }

  if (args.length === 3 && isFeelNumber(first) && isFeelNumber(second) && isFeelNumber(third)) {
    try {
      return Temporal.PlainDate.from(
        { year: first.toNumber(), month: second.toNumber(), day: third.toNumber() },
        { overflow: 'reject' },
      );
    } catch {
      return null;
    }
  }

  // date(dateTime) truncates to the date part.
  if (isPlainDateTime(first)) return first.toPlainDate();
  if (isZoned(first)) return first.toPlainDate();
  if (isPlainDate(first)) return first;

  return null;
}

function buildTime(args: readonly FeelValue[]): FeelValue {
  const [first, second, third, fourth] = args;

  if (typeof first === 'string' && args.length === 1) {
    return parseTime(first);
  }

  if (args.length >= 3 && isFeelNumber(first) && isFeelNumber(second) && isFeelNumber(third)) {
    let time: Temporal.PlainTime;
    try {
      time = Temporal.PlainTime.from(
        {
          hour: first.toNumber(),
          minute: second.toNumber(),
          second: third.toNumber(),
        },
        { overflow: 'reject' },
      );
    } catch {
      return null;
    }

    // A fourth argument is the offset, as a days-and-time duration.
    if (fourth === undefined || fourth === null) {
      return time;
    }

    if (!isFeelDuration(fourth) || fourth.durationKind !== 'dayTime') {
      return null;
    }

    return anchorWithOffset(time, secondsOf(fourth));
  }

  if (isPlainDateTime(first)) return first.toPlainTime();
  if (isZoned(first)) return first.toPlainTime();
  if (isPlainTime(first)) return first;

  return null;
}

/** A time with an offset needs a date to hang on; FEEL uses the epoch. */
function anchorWithOffset(time: Temporal.PlainTime, offsetSeconds: number): FeelValue {
  const sign = offsetSeconds < 0 ? '-' : '+';
  const total = Math.abs(offsetSeconds);
  const hours = String(Math.floor(total / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');

  try {
    return Temporal.ZonedDateTime.from(
      `1970-01-01T${time.toString()}${sign}${hours}:${minutes}[${sign}${hours}:${minutes}]`,
    );
  } catch {
    return null;
  }
}

function buildDateTime(args: readonly FeelValue[]): FeelValue {
  const [first, second] = args;

  if (typeof first === 'string' && args.length === 1) {
    return parseDateTime(first);
  }

  // date and time(date, time) combines the two parts.
  if (args.length === 2) {
    const date = isPlainDate(first)
      ? first
      : isPlainDateTime(first)
        ? first.toPlainDate()
        : isZoned(first)
          ? first.toPlainDate()
          : null;

    if (date === null) {
      return null;
    }

    if (isPlainTime(second)) {
      return date.toPlainDateTime(second);
    }

    if (isZoned(second)) {
      // Carry the offset across from the time.
      try {
        return Temporal.ZonedDateTime.from({
          timeZone: second.timeZoneId,
          year: date.year,
          month: date.month,
          day: date.day,
          hour: second.hour,
          minute: second.minute,
          second: second.second,
        });
      } catch {
        return null;
      }
    }

    return null;
  }

  return null;
}

function buildYearMonthDuration(args: readonly FeelValue[]): FeelValue {
  const [from, to] = args;

  if (typeof from === 'string' && args.length === 1) {
    return parseDuration(from);
  }

  const start = toPlainDate(from ?? null);
  const end = toPlainDate(to ?? null);

  if (start === null || end === null) {
    return null;
  }

  const between = start.until(end, { largestUnit: 'years' });

  return duration(
    Temporal.Duration.from({ years: between.years, months: between.months }),
    'yearMonth',
  );
}

function toPlainDate(value: FeelValue): Temporal.PlainDate | null {
  if (isPlainDate(value)) return value;
  if (isPlainDateTime(value)) return value.toPlainDate();
  if (isZoned(value)) return value.toPlainDate();
  return null;
}

// --- arithmetic -----------------------------------------------------------

/**
 * Arithmetic over temporal values.
 *
 * Returns `undefined` when neither operand is temporal, so the caller can fall
 * through to numeric arithmetic; returns `null` when the combination is
 * temporal but meaningless.
 */
export function temporalArithmetic(
  operator: string,
  left: FeelValue,
  right: FeelValue,
): FeelValue | undefined {
  const leftTemporal = isTemporal(left);
  const rightTemporal = isTemporal(right);

  if (!leftTemporal && !rightTemporal) {
    return undefined;
  }

  try {
    if (operator === '+') return add(left, right);
    if (operator === '-') return subtract(left, right);
    if (operator === '*') return scale(left, right);
    if (operator === '/') return divide(left, right);
  } catch {
    return null;
  }

  return null;
}

function isTemporal(value: FeelValue): value is FeelTemporal {
  return (
    isPlainDate(value) ||
    isPlainTime(value) ||
    isPlainDateTime(value) ||
    isZoned(value) ||
    isFeelDuration(value)
  );
}

function add(left: FeelValue, right: FeelValue): FeelValue {
  // duration + duration, of the same kind.
  if (isFeelDuration(left) && isFeelDuration(right)) {
    return left.durationKind === right.durationKind ? combine(left, right, 1) : null;
  }

  const [moment, span] = isFeelDuration(right) ? [left, right] : [right, left];

  if (!isFeelDuration(span)) {
    return null;
  }

  if (isPlainDate(moment)) {
    // Adding a time-bearing duration to a date yields a date and time.
    return span.durationKind === 'yearMonth'
      ? moment.add(span.value)
      : moment.toPlainDateTime().add(span.value);
  }

  if (isPlainDateTime(moment) || isZoned(moment)) {
    return moment.add(span.value);
  }

  if (isPlainTime(moment)) {
    return span.durationKind === 'dayTime' ? moment.add(span.value) : null;
  }

  return null;
}

function subtract(left: FeelValue, right: FeelValue): FeelValue {
  // Two moments of the same type give the elapsed days-and-time duration.
  if (isPlainDate(left) && isPlainDate(right)) {
    return duration(right.until(left, { largestUnit: 'days' }), 'dayTime');
  }

  if (isPlainDateTime(left) && isPlainDateTime(right)) {
    return duration(right.until(left, { largestUnit: 'days' }), 'dayTime');
  }

  if (isZoned(left) && isZoned(right)) {
    return duration(right.until(left, { largestUnit: 'hours' }), 'dayTime');
  }

  if (isPlainTime(left) && isPlainTime(right)) {
    return duration(right.until(left, { largestUnit: 'hours' }), 'dayTime');
  }

  if (isFeelDuration(left) && isFeelDuration(right)) {
    return left.durationKind === right.durationKind ? combine(left, right, -1) : null;
  }

  // moment - duration moves backwards.
  if (isFeelDuration(right)) {
    if (isPlainDate(left)) {
      return right.durationKind === 'yearMonth'
        ? left.subtract(right.value)
        : left.toPlainDateTime().subtract(right.value);
    }
    if (isPlainDateTime(left) || isZoned(left)) {
      return left.subtract(right.value);
    }
    if (isPlainTime(left)) {
      return right.durationKind === 'dayTime' ? left.subtract(right.value) : null;
    }
  }

  return null;
}

function scale(left: FeelValue, right: FeelValue): FeelValue {
  const [span, factor] = isFeelDuration(left) ? [left, right] : [right, left];

  if (!isFeelDuration(span) || !isFeelNumber(factor)) {
    return null;
  }

  return multiplyDuration(span, factor.toNumber());
}

function divide(left: FeelValue, right: FeelValue): FeelValue {
  if (!isFeelDuration(left)) {
    return null;
  }

  // duration / duration is a plain ratio.
  if (isFeelDuration(right)) {
    if (left.durationKind !== right.durationKind) {
      return null;
    }
    const divisor = right.durationKind === 'yearMonth' ? monthsOf(right) : secondsOf(right);
    if (divisor === 0) {
      return null;
    }
    const dividend = left.durationKind === 'yearMonth' ? monthsOf(left) : secondsOf(left);
    return toFeelNumber(String(dividend / divisor));
  }

  if (!isFeelNumber(right) || right.isZero()) {
    return null;
  }

  return multiplyDuration(left, 1 / right.toNumber());
}

/**
 * Adds or subtracts two durations of the same kind.
 *
 * Done through totals rather than `Temporal.Duration.add`, which refuses to
 * combine calendar units without a `relativeTo` anchor — and a FEEL duration
 * has no anchor, which is precisely why the two kinds are separate types.
 */
function combine(left: FeelDuration, right: FeelDuration, sign: 1 | -1): FeelValue {
  if (left.durationKind === 'yearMonth') {
    const months = monthsOf(left) + sign * monthsOf(right);
    return duration(
      Temporal.Duration.from({ years: Math.trunc(months / 12), months: months % 12 }),
      'yearMonth',
    );
  }

  const seconds = secondsOf(left) + sign * secondsOf(right);
  return dayTimeOf(seconds);
}

/**
 * Builds a days-and-time duration in balanced form.
 *
 * Seconds alone would be arithmetically right and lexically wrong: `PT259200S`
 * rather than `P3D`. Comparison against a recorded expectation is lexical for
 * durations, so the canonical form matters.
 */
function dayTimeOf(seconds: number): FeelValue {
  try {
    return duration(
      Temporal.Duration.from({ seconds }).round({ largestUnit: 'day' }),
      'dayTime',
    );
  } catch {
    return null;
  }
}

function multiplyDuration(span: FeelDuration, factor: number): FeelValue {
  if (!Number.isFinite(factor)) {
    return null;
  }

  if (span.durationKind === 'yearMonth') {
    const months = Math.trunc(monthsOf(span) * factor);
    return duration(Temporal.Duration.from({ months }), 'yearMonth');
  }

  const seconds = Math.trunc(secondsOf(span) * factor);
  return dayTimeOf(seconds);
}

// --- properties -----------------------------------------------------------

/**
 * Property access on a temporal value: `date.year`, `duration.days` and so on.
 *
 * Returns `undefined` when the value is not temporal, so path evaluation can
 * fall through to context lookup.
 */
export function temporalProperty(value: FeelValue, name: string): FeelValue | undefined {
  if (isFeelDuration(value)) {
    return durationProperty(value, name);
  }

  if (isPlainDate(value)) {
    return dateProperty(value.year, value.month, value.day, value.dayOfWeek, name);
  }

  if (isPlainDateTime(value)) {
    return first(
      dateProperty(value.year, value.month, value.day, value.dayOfWeek, name),
      timeProperty(value.hour, value.minute, value.second, name),
    );
  }

  if (isZoned(value)) {
    return first(
      dateProperty(value.year, value.month, value.day, value.dayOfWeek, name),
      timeProperty(value.hour, value.minute, value.second, name),
      zoneProperty(value, name),
    );
  }

  if (isPlainTime(value)) {
    return timeProperty(value.hour, value.minute, value.second, name) ?? null;
  }

  return undefined;
}

/**
 * The first candidate that recognised the name, or null.
 *
 * `??` cannot be used here: a property may legitimately evaluate to FEEL null,
 * and that has to win over the next candidate rather than fall through to it.
 */
function first(...candidates: readonly (FeelValue | undefined)[]): FeelValue {
  for (const candidate of candidates) {
    if (candidate !== undefined) {
      return candidate;
    }
  }
  return null;
}

function dateProperty(
  year: number,
  month: number,
  day: number,
  dayOfWeek: number,
  name: string,
): FeelValue | undefined {
  switch (name) {
    case 'year':
      return toFeelNumber(String(year));
    case 'month':
      return toFeelNumber(String(month));
    case 'day':
      return toFeelNumber(String(day));
    case 'weekday':
      return toFeelNumber(String(dayOfWeek));
    default:
      return undefined;
  }
}

function timeProperty(
  hour: number,
  minute: number,
  second: number,
  name: string,
): FeelValue | undefined {
  switch (name) {
    case 'hour':
      return toFeelNumber(String(hour));
    case 'minute':
      return toFeelNumber(String(minute));
    case 'second':
      return toFeelNumber(String(second));
    default:
      return undefined;
  }
}

function zoneProperty(value: Temporal.ZonedDateTime, name: string): FeelValue | undefined {
  switch (name) {
    case 'time offset':
      return duration(Temporal.Duration.from({ seconds: value.offsetNanoseconds / 1e9 }), 'dayTime');
    case 'timezone':
      return value.timeZoneId;
    default:
      return undefined;
  }
}

function durationProperty(value: FeelDuration, name: string): FeelValue | undefined {
  const total = value.value;

  if (value.durationKind === 'yearMonth') {
    const months = monthsOf(value);
    switch (name) {
      case 'years':
        return toFeelNumber(String(Math.trunc(months / 12)));
      case 'months':
        return toFeelNumber(String(months % 12));
      default:
        return null;
    }
  }

  const seconds = secondsOf(value);
  switch (name) {
    case 'days':
      return toFeelNumber(String(Math.trunc(seconds / 86400)));
    case 'hours':
      return toFeelNumber(String(Math.trunc((seconds % 86400) / 3600)));
    case 'minutes':
      return toFeelNumber(String(Math.trunc((seconds % 3600) / 60)));
    case 'seconds':
      return toFeelNumber(String(Math.trunc(seconds % 60)));
    default:
      return total === undefined ? null : null;
  }
}

export type { FeelNumber };
