/**
 * FEEL temporal values.
 *
 * Original work. The internal
 * representation *is* the TC39 Temporal type, not a wrapper over it. Defining
 * parallel classes would put a bidirectional conversion on every expression
 * boundary — the most defect-prone place to put one.
 *
 * FEEL has five temporal types, and the two duration types are genuinely
 * distinct: `duration("P1Y")` and `duration("P365D")` are not comparable,
 * because a year is not a fixed number of days. Temporal.Duration can express
 * both, so the FEEL type is carried alongside it rather than inferred from
 * which fields happen to be populated.
 */

import { Temporal } from 'temporal-polyfill';

export type FeelDate = Temporal.PlainDate;
export type FeelTime = Temporal.PlainTime | Temporal.ZonedDateTime;
export type FeelDateTime = Temporal.PlainDateTime | Temporal.ZonedDateTime;

/**
 * A FEEL duration.
 *
 * `kind` records which of the two FEEL duration types this is. It is not
 * derivable from the value: a zero duration is legitimately either.
 */
export interface FeelDuration {
  readonly kind: 'duration';
  readonly durationKind: 'yearMonth' | 'dayTime';
  readonly value: Temporal.Duration;
}

export type FeelTemporal = FeelDate | FeelTime | FeelDateTime | FeelDuration;

export function isFeelDuration(value: unknown): value is FeelDuration {
  return (
    typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'duration'
  );
}

export function isPlainDate(value: unknown): value is Temporal.PlainDate {
  return value instanceof Temporal.PlainDate;
}

export function isPlainTime(value: unknown): value is Temporal.PlainTime {
  return value instanceof Temporal.PlainTime;
}

export function isPlainDateTime(value: unknown): value is Temporal.PlainDateTime {
  return value instanceof Temporal.PlainDateTime;
}

export function isZoned(value: unknown): value is Temporal.ZonedDateTime {
  return value instanceof Temporal.ZonedDateTime;
}

export function isFeelTemporal(value: unknown): value is FeelTemporal {
  return (
    isPlainDate(value) ||
    isPlainTime(value) ||
    isPlainDateTime(value) ||
    isZoned(value) ||
    isFeelDuration(value)
  );
}

/** The FEEL type name, as `instance of` and diagnostics report it. */
export function temporalTypeOf(value: FeelTemporal): string {
  if (isFeelDuration(value)) {
    return value.durationKind === 'yearMonth' ? 'years and months duration' : 'days and time duration';
  }
  if (isPlainDate(value)) return 'date';
  if (isPlainTime(value)) return 'time';
  if (isPlainDateTime(value)) return 'date and time';
  // A zoned value is a date and time unless it carries only a time of day,
  // which the time constructor records by anchoring to the epoch date.
  return value.toPlainDate().equals(EPOCH_DATE) ? 'time' : 'date and time';
}

/** Anchor date for a time-with-offset, which has no date of its own. */
const EPOCH_DATE = Temporal.PlainDate.from('1970-01-01');

// --- construction ---------------------------------------------------------

/**
 * Every constructor returns null rather than throwing on malformed input.
 * FEEL has no exceptions: an invalid value is null (DMN 1.5), and the caller
 * reports it as a diagnostic if it cares.
 */

export function parseDate(text: string): FeelDate | null {
  try {
    return Temporal.PlainDate.from(text.trim(), { overflow: 'reject' });
  } catch {
    return null;
  }
}

export function parseTime(text: string): FeelTime | null {
  const trimmed = text.trim();

  // A time may carry a zone or an offset; both need a date to anchor to.
  const zoned = /\[(?<zone>[^\]]+)\]$/u.exec(trimmed);
  if (zoned?.groups?.['zone'] !== undefined) {
    try {
      return Temporal.ZonedDateTime.from(
        `${EPOCH_DATE.toString()}T${trimmed}`,
        { overflow: 'reject' },
      );
    } catch {
      return null;
    }
  }

  if (/[+-]\d{2}:\d{2}$|Z$/u.test(trimmed)) {
    try {
      return Temporal.ZonedDateTime.from(`${EPOCH_DATE.toString()}T${trimmed}[UTC]`, {
        overflow: 'reject',
      }).withTimeZone(offsetZoneOf(trimmed));
    } catch {
      // Fall through to the plain reading below.
    }
  }

  try {
    return Temporal.PlainTime.from(trimmed, { overflow: 'reject' });
  } catch {
    return null;
  }
}

function offsetZoneOf(text: string): string {
  const match = /(?<offset>[+-]\d{2}:\d{2})$/u.exec(text);
  return match?.groups?.['offset'] ?? 'UTC';
}

export function parseDateTime(text: string): FeelDateTime | null {
  const trimmed = text.trim();

  try {
    if (/\[[^\]]+\]$/u.test(trimmed)) {
      return Temporal.ZonedDateTime.from(trimmed, { overflow: 'reject' });
    }
    if (/[+-]\d{2}:\d{2}$|Z$/u.test(trimmed)) {
      const zone = trimmed.endsWith('Z') ? 'UTC' : offsetZoneOf(trimmed);
      return Temporal.ZonedDateTime.from(`${trimmed}[${zone}]`, { overflow: 'reject' });
    }
    return Temporal.PlainDateTime.from(trimmed, { overflow: 'reject' });
  } catch {
    return null;
  }
}

/**
 * Parses an ISO 8601 duration into whichever FEEL duration type it denotes.
 *
 * A years-and-months duration has no day or time component; anything else is a
 * days-and-time duration. The distinction is lexical because FEEL treats the
 * two as different types, not as one type with optional fields.
 */
export function parseDuration(text: string): FeelDuration | null {
  const trimmed = text.trim();

  let parsed: Temporal.Duration;
  try {
    parsed = Temporal.Duration.from(trimmed);
  } catch {
    return null;
  }

  const body = trimmed.startsWith('-') ? trimmed.slice(1) : trimmed;
  const datePart = body.includes('T') ? body.slice(0, body.indexOf('T')) : body;
  const yearMonthOnly = !body.includes('T') && !datePart.includes('D');

  return {
    kind: 'duration',
    durationKind: yearMonthOnly ? 'yearMonth' : 'dayTime',
    value: parsed,
  };
}

export function duration(
  value: Temporal.Duration,
  durationKind: 'yearMonth' | 'dayTime',
): FeelDuration {
  return { kind: 'duration', durationKind, value };
}

/**
 * Reads an `@"..."` literal, whose type is determined by its shape.
 *
 * Order matters: a duration starts with `P`, a date-and-time contains `T` in
 * date position, a time contains `:` but no `-` before it.
 */
export function parseAtLiteral(text: string): FeelTemporal | null {
  const trimmed = text.trim();

  if (/^-?P/u.test(trimmed)) {
    return parseDuration(trimmed);
  }

  if (trimmed.includes('T')) {
    return parseDateTime(trimmed);
  }

  if (/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) {
    return parseDate(trimmed);
  }

  return parseTime(trimmed);
}

// --- comparison -----------------------------------------------------------

/**
 * Orders two temporal values, or returns null when they are not comparable.
 *
 * Cross-type comparison is null rather than an error, and the two duration
 * kinds never compare: months and days have no fixed ratio, so the question has
 * no answer rather than a default one.
 */
export function compareTemporal(left: FeelTemporal, right: FeelTemporal): number | null {
  if (isFeelDuration(left) || isFeelDuration(right)) {
    if (!isFeelDuration(left) || !isFeelDuration(right)) {
      return null;
    }
    if (left.durationKind !== right.durationKind) {
      return null;
    }
    return left.durationKind === 'yearMonth'
      ? compareNumbers(monthsOf(left), monthsOf(right))
      : compareNumbers(secondsOf(left), secondsOf(right));
  }

  if (temporalTypeOf(left) !== temporalTypeOf(right)) {
    return null;
  }

  try {
    if (isPlainDate(left) && isPlainDate(right)) {
      return Temporal.PlainDate.compare(left, right);
    }
    if (isPlainTime(left) && isPlainTime(right)) {
      return Temporal.PlainTime.compare(left, right);
    }
    if (isPlainDateTime(left) && isPlainDateTime(right)) {
      return Temporal.PlainDateTime.compare(left, right);
    }
    if (isZoned(left) && isZoned(right)) {
      return Temporal.ZonedDateTime.compare(left, right);
    }
    // A zoned value compared with a plain one of the same FEEL type: compare
    // the wall-clock reading, which is what the plain value expresses.
    const leftPlain = isZoned(left) ? left.toPlainDateTime() : left;
    const rightPlain = isZoned(right) ? right.toPlainDateTime() : right;

    if (isPlainDateTime(leftPlain) && isPlainDateTime(rightPlain)) {
      return Temporal.PlainDateTime.compare(leftPlain, rightPlain);
    }
    if (isPlainTime(leftPlain) && isPlainTime(rightPlain)) {
      return Temporal.PlainTime.compare(leftPlain, rightPlain);
    }
  } catch {
    return null;
  }

  return null;
}

function compareNumbers(left: number, right: number): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Total months in a years-and-months duration. */
export function monthsOf(value: FeelDuration): number {
  return value.value.years * 12 + value.value.months;
}

/** Total seconds in a days-and-time duration. */
export function secondsOf(value: FeelDuration): number {
  return value.value.total({ unit: 'seconds' });
}

// --- rendering ------------------------------------------------------------

/** The ISO 8601 lexical form, which is how temporal values serialize. */
export function temporalToString(value: FeelTemporal): string {
  return isFeelDuration(value) ? value.value.toString() : value.toString();
}
