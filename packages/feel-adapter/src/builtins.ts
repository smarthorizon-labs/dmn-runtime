/**
 * The FEEL built-in function library.
 *
 * Original work, written against the OMG DMN 1.5 built-in list and verified
 * against Apache KIE Drools 10.2.0 through the differential harness — the
 * recorded reference values are the expectation, not this author's reading.
 *
 * Two rules run through every function here:
 *
 * - **A wrong argument gives null, never an exception.** FEEL has no error
 *   values; `substring("a", "b")` is null. Hosts should never see a throw
 *   escaping evaluation.
 * - **Nothing that reads ambient state.** `now()` and `today()` are absent on
 *   purpose: they would make evaluation non-deterministic, which is ruled
 *   out until a clock can be injected through the request. They
 *   report as unknown functions rather than silently reading the host clock.
 *
 * Built-ins are looked up only after the evaluation context, so a model
 * variable of the same name shadows one, as FEEL scoping requires.
 */

import { FeelDecimal, isFeelNumber, toFeelNumber, type FeelNumber } from './number.js';
import { constructTemporal } from './temporal-ops.js';
import { isFeelDuration, isPlainDate, isPlainDateTime, isZoned } from './temporal.js';
import {
  feelEquals,
  isFeelList,
  type FeelFunction,
  type FeelValue,
} from './values.js';

function define(
  name: string,
  parameters: readonly string[],
  invoke: (args: readonly FeelValue[]) => FeelValue,
): [string, FeelFunction] {
  return [name, { kind: 'function', name, parameters, invoke }];
}

// --- argument helpers -----------------------------------------------------

function num(value: FeelValue | undefined): FeelNumber | null {
  return isFeelNumber(value) ? value : null;
}

function str(value: FeelValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function int(value: FeelValue | undefined): number | null {
  const parsed = num(value);
  return parsed === null || !parsed.isInteger() ? null : parsed.toNumber();
}

/**
 * The list a variadic aggregate operates on.
 *
 * `sum([1, 2])` and `sum(1, 2)` are both legal, so a single list argument is
 * the list and anything else is the argument list itself.
 */
function listArg(args: readonly FeelValue[]): readonly FeelValue[] | null {
  if (args.length === 1) {
    const only = args[0];
    return isFeelList(only) ? only : [only ?? null];
  }
  return args;
}

function numbersOf(args: readonly FeelValue[]): readonly FeelNumber[] | null {
  const items = listArg(args);
  if (items === null) {
    return null;
  }
  const numbers = items.filter(isFeelNumber);
  return numbers.length === items.length ? numbers : null;
}

function decimalOp(value: FeelValue | undefined, apply: (input: FeelNumber) => FeelNumber): FeelValue {
  const parsed = num(value);
  if (parsed === null) {
    return null;
  }
  try {
    const result = apply(parsed);
    return result.isFinite() ? result : null;
  } catch {
    return null;
  }
}

/** Rounding, shared by the four `round *` built-ins. */
type Rounding = Parameters<FeelNumber['toDecimalPlaces']>[1];

function roundTo(
  value: FeelValue | undefined,
  scale: FeelValue | undefined,
  mode: Rounding,
): FeelValue {
  const parsed = num(value);
  const digits = scale === undefined ? 0 : int(scale);

  if (parsed === null || digits === null) {
    return null;
  }

  try {
    return parsed.toDecimalPlaces(digits, mode);
  } catch {
    return null;
  }
}

const ENTRIES: readonly [string, FeelFunction][] = [
  // --- boolean ------------------------------------------------------------

  /**
   * Ternary negation: false for true, true for false, null for anything else.
   * A function rather than an operator in FEEL, which is why it lives here.
   */
  define('not', ['negand'], (args) => {
    const value = args[0];
    return typeof value === 'boolean' ? !value : null;
  }),

  define('any', ['list'], (args) => {
    const items = listArg(args);
    if (items === null) return null;
    if (items.some((item) => item === true)) return true;
    return items.every((item) => item === false) ? false : null;
  }),

  define('all', ['list'], (args) => {
    const items = listArg(args);
    if (items === null) return null;
    if (items.some((item) => item === false)) return false;
    return items.every((item) => item === true) ? true : null;
  }),

  // --- numeric ------------------------------------------------------------

  define('abs', ['n'], (args) => decimalOp(args[0], (value) => value.abs())),
  define('floor', ['n'], (args) => decimalOp(args[0], (value) => value.floor())),
  define('ceiling', ['n'], (args) => decimalOp(args[0], (value) => value.ceil())),
  define('sqrt', ['number'], (args) =>
    decimalOp(args[0], (value) => {
      if (value.isNegative()) {
        throw new RangeError('sqrt of a negative number');
      }
      return value.sqrt();
    }),
  ),
  define('exp', ['number'], (args) => decimalOp(args[0], (value) => value.exp())),
  define('log', ['number'], (args) =>
    decimalOp(args[0], (value) => {
      if (!value.greaterThan(0)) {
        throw new RangeError('log of a non-positive number');
      }
      return value.ln();
    }),
  ),

  define('round up', ['n', 'scale'], (args) => roundTo(args[0], args[1], FeelDecimal.ROUND_UP)),
  define('round down', ['n', 'scale'], (args) => roundTo(args[0], args[1], FeelDecimal.ROUND_DOWN)),
  define('round half up', ['n', 'scale'], (args) =>
    roundTo(args[0], args[1], FeelDecimal.ROUND_HALF_UP),
  ),
  define('round half down', ['n', 'scale'], (args) =>
    roundTo(args[0], args[1], FeelDecimal.ROUND_HALF_DOWN),
  ),
  define('decimal', ['n', 'scale'], (args) =>
    roundTo(args[0], args[1], FeelDecimal.ROUND_HALF_EVEN),
  ),

  /**
   * FEEL modulo follows the sign of the divisor, which is the mathematical
   * definition rather than the remainder most languages give for `%`.
   */
  define('modulo', ['dividend', 'divisor'], (args) => {
    const dividend = num(args[0]);
    const divisor = num(args[1]);

    if (dividend === null || divisor === null || divisor.isZero()) {
      return null;
    }

    return dividend.minus(divisor.times(dividend.dividedBy(divisor).floor()));
  }),

  define('even', ['number'], (args) => {
    const value = int(args[0]);
    return value === null ? null : value % 2 === 0;
  }),

  define('odd', ['number'], (args) => {
    const value = int(args[0]);
    return value === null ? null : Math.abs(value % 2) === 1;
  }),

  define('number', ['from'], (args) => {
    const text = str(args[0]);
    return text === null ? null : toFeelNumber(text);
  }),

  // --- aggregation --------------------------------------------------------

  define('count', ['list'], (args) => {
    const items = listArg(args);
    return items === null ? null : toFeelNumber(String(items.length));
  }),

  define('sum', ['list'], (args) => {
    const numbers = numbersOf(args);
    if (numbers === null) return null;
    return numbers.reduce<FeelNumber>((total, item) => total.plus(item), new FeelDecimal(0));
  }),

  define('mean', ['list'], (args) => {
    const numbers = numbersOf(args);
    if (numbers === null || numbers.length === 0) return null;
    const total = numbers.reduce<FeelNumber>((sum, item) => sum.plus(item), new FeelDecimal(0));
    return total.dividedBy(numbers.length);
  }),

  define('min', ['list'], (args) => extremum(args, 'min')),
  define('max', ['list'], (args) => extremum(args, 'max')),

  // --- strings ------------------------------------------------------------

  define('string length', ['string'], (args) => {
    const text = str(args[0]);
    // Counted in code points, so an astral character is one character.
    return text === null ? null : toFeelNumber(String([...text].length));
  }),

  define('upper case', ['string'], (args) => str(args[0])?.toUpperCase() ?? null),
  define('lower case', ['string'], (args) => str(args[0])?.toLowerCase() ?? null),

  /** FEEL string positions are 1-based, and a negative start counts from the end. */
  define('substring', ['string', 'start position', 'length'], (args) => {
    const text = str(args[0]);
    const start = int(args[1]);

    if (text === null || start === null || start === 0) {
      return null;
    }

    const characters = [...text];
    const from = start > 0 ? start - 1 : characters.length + start;

    if (from < 0 || from > characters.length) {
      return null;
    }

    if (args[2] === undefined || args[2] === null) {
      return characters.slice(from).join('');
    }

    const length = int(args[2]);
    return length === null || length < 0 ? null : characters.slice(from, from + length).join('');
  }),

  define('contains', ['string', 'match'], (args) => {
    const text = str(args[0]);
    const match = str(args[1]);
    return text === null || match === null ? null : text.includes(match);
  }),

  define('starts with', ['string', 'match'], (args) => {
    const text = str(args[0]);
    const match = str(args[1]);
    return text === null || match === null ? null : text.startsWith(match);
  }),

  define('ends with', ['string', 'match'], (args) => {
    const text = str(args[0]);
    const match = str(args[1]);
    return text === null || match === null ? null : text.endsWith(match);
  }),

  define('string join', ['list', 'delimiter'], (args) => {
    const items = args.length === 1 ? args[0] : args[0];
    if (!isFeelList(items)) return null;

    const parts: string[] = [];
    for (const item of items) {
      if (item === null) continue;
      if (typeof item !== 'string') return null;
      parts.push(item);
    }

    const delimiter = args[1] === undefined || args[1] === null ? '' : str(args[1]);
    return delimiter === null ? null : parts.join(delimiter);
  }),

  define('string', ['from'], (args) => {
    const value = args[0];
    if (value === undefined || value === null) return null;
    return renderAsString(value);
  }),

  // --- lists --------------------------------------------------------------

  define('list contains', ['list', 'element'], (args) => {
    const items = args[0];
    if (!isFeelList(items)) return null;

    let sawNull = false;
    for (const item of items) {
      const equal = feelEquals(item, args[1] ?? null);
      if (equal === true) return true;
      if (equal === null) sawNull = true;
    }
    return sawNull ? null : false;
  }),

  define('append', ['list', 'item'], (args) => {
    const items = args[0];
    return isFeelList(items) ? [...items, ...args.slice(1)] : null;
  }),

  define('concatenate', ['list'], (args) => {
    const result: FeelValue[] = [];
    for (const item of args) {
      if (!isFeelList(item)) return null;
      result.push(...item);
    }
    return result;
  }),

  define('reverse', ['list'], (args) => {
    const items = args[0];
    return isFeelList(items) ? [...items].reverse() : null;
  }),

  define('index of', ['list', 'match'], (args) => {
    const items = args[0];
    if (!isFeelList(items)) return null;

    const found: FeelValue[] = [];
    items.forEach((item, index) => {
      if (feelEquals(item, args[1] ?? null) === true) {
        found.push(toFeelNumber(String(index + 1)));
      }
    });
    return found;
  }),

  define('distinct values', ['list'], (args) => {
    const items = args[0];
    if (!isFeelList(items)) return null;

    const seen: FeelValue[] = [];
    for (const item of items) {
      if (!seen.some((kept) => feelEquals(kept, item) === true)) {
        seen.push(item);
      }
    }
    return seen;
  }),

  define('flatten', ['list'], (args) => {
    const items = args[0];
    if (!isFeelList(items)) return null;

    const flat: FeelValue[] = [];
    const walk = (values: readonly FeelValue[]): void => {
      for (const value of values) {
        if (isFeelList(value)) {
          walk(value);
        } else {
          flat.push(value);
        }
      }
    };
    walk(items);
    return flat;
  }),

  define('sublist', ['list', 'start position', 'length'], (args) => {
    const items = args[0];
    const start = int(args[1]);

    if (!isFeelList(items) || start === null || start === 0) {
      return null;
    }

    const from = start > 0 ? start - 1 : items.length + start;
    if (from < 0 || from > items.length) {
      return null;
    }

    if (args[2] === undefined || args[2] === null) {
      return items.slice(from);
    }

    const length = int(args[2]);
    return length === null || length < 0 ? null : items.slice(from, from + length);
  }),

  // --- temporal -----------------------------------------------------------

  // These share their implementations with the literal forms, so
  // `date("2024-01-01")` written as a call and as a literal cannot diverge.
  define('date', ['from'], (args) => asValue(constructTemporal('date', args))),
  define('time', ['from'], (args) => asValue(constructTemporal('time', args))),
  define('date and time', ['from'], (args) => asValue(constructTemporal('date and time', args))),
  define('duration', ['from'], (args) => asValue(constructTemporal('duration', args))),
  define('years and months duration', ['from', 'to'], (args) =>
    asValue(constructTemporal('years and months duration', args)),
  ),

  define('day of week', ['date'], (args) => {
    const day = dayOfWeekOf(args[0]);
    return day === null ? null : WEEKDAYS[day - 1] ?? null;
  }),

  define('month of year', ['date'], (args) => {
    const month = monthOf(args[0]);
    return month === null ? null : (MONTHS[month - 1] ?? null);
  }),

  define('day of year', ['date'], (args) => {
    const value = args[0];
    const date = isPlainDate(value)
      ? value
      : isPlainDateTime(value) || isZoned(value)
        ? value.toPlainDate()
        : null;
    return date === null ? null : toFeelNumber(String(date.dayOfYear));
  }),
];

export const BUILTINS: ReadonlyMap<string, FeelFunction> = new Map(ENTRIES);

// --- shared implementations -----------------------------------------------

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function asValue(result: FeelValue | symbol): FeelValue {
  return typeof result === 'symbol' ? null : result;
}

function dayOfWeekOf(value: FeelValue | undefined): number | null {
  if (isPlainDate(value)) return value.dayOfWeek;
  if (isPlainDateTime(value) || isZoned(value)) return value.dayOfWeek;
  return null;
}

function monthOf(value: FeelValue | undefined): number | null {
  if (isPlainDate(value)) return value.month;
  if (isPlainDateTime(value) || isZoned(value)) return value.month;
  return null;
}

function extremum(args: readonly FeelValue[], which: 'min' | 'max'): FeelValue {
  const numbers = numbersOf(args);

  if (numbers === null || numbers.length === 0) {
    return null;
  }

  return numbers.reduce((best, item) => {
    const takeItem = which === 'min' ? item.lessThan(best) : item.greaterThan(best);
    return takeItem ? item : best;
  });
}

/** The FEEL `string()` rendering, which is the value's lexical form. */
function renderAsString(value: FeelValue): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  if (isFeelNumber(value)) return value.toFixed();
  if (isFeelDuration(value)) return value.value.toString();
  if (isPlainDate(value) || isPlainDateTime(value) || isZoned(value)) return value.toString();

  if (isFeelList(value)) {
    const parts = value.map(renderAsString);
    return parts.some((part) => part === null) ? null : `[${parts.join(', ')}]`;
  }

  return null;
}
