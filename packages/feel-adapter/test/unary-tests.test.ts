/**
 * Unary tests, exercised with the input entries from the committed DMN 1.2
 * sample (`samples/loan-pre-qualification.dmn`). Using entries a real modeler
 * produced keeps the first slice honest about the shapes it must handle.
 */

import { describe, expect, it } from 'vitest';

import { createFeelEngine } from '../src/engine.js';
import { toFeelNumber } from '../src/number.js';
import type { FeelValue } from '../src/values.js';

const engine = createFeelEngine();

function test(source: string, value: FeelValue) {
  const compiled = engine.compileUnaryTests(source);
  expect(compiled.diagnostics).toEqual([]);
  return compiled.test(value, {}).value;
}

const fico = (score: string) => toFeelNumber(score);

describe('irrelevant entries', () => {
  it('matches anything for the dash entry', () => {
    expect(test('-', fico('700'))).toBe(true);
    expect(test('-', null)).toBe(true);
    expect(test('-', 'anything')).toBe(true);
  });
});

describe('comparison entries', () => {
  it('evaluates >= against the tested value', () => {
    expect(test('>= 750', fico('800'))).toBe(true);
    expect(test('>= 750', fico('750'))).toBe(true);
    expect(test('>= 750', fico('749'))).toBe(false);
  });

  it('evaluates < against the tested value', () => {
    expect(test('< 600', fico('599'))).toBe(true);
    expect(test('< 600', fico('600'))).toBe(false);
  });
});

describe('interval entries', () => {
  it('honours a half-open interval', () => {
    // [700..750) from the Credit Score Rating table.
    expect(test('[700..750)', fico('700'))).toBe(true);
    expect(test('[700..750)', fico('749'))).toBe(true);
    expect(test('[700..750)', fico('750'))).toBe(false);
    expect(test('[700..750)', fico('699'))).toBe(false);
  });

  it('honours a closed interval', () => {
    expect(test('[300..850]', fico('300'))).toBe(true);
    expect(test('[300..850]', fico('850'))).toBe(true);
    expect(test('[300..850]', fico('851'))).toBe(false);
  });

  it('compares interval bounds in decimal', () => {
    expect(test('[0.1..0.3]', toFeelNumber('0.30'))).toBe(true);
  });
});

describe('alternative entries', () => {
  it('matches any listed alternative', () => {
    // "Poor", "Bad" from the Loan Pre-Qualification table.
    expect(test('"Poor", "Bad"', 'Poor')).toBe(true);
    expect(test('"Poor", "Bad"', 'Bad')).toBe(true);
    expect(test('"Poor", "Bad"', 'Good')).toBe(false);
  });

  it('matches a single literal by equality', () => {
    expect(test('"Sufficient"', 'Sufficient')).toBe(true);
    expect(test('"Sufficient"', 'Insufficient')).toBe(false);
  });
});

describe('negated entries', () => {
  // The parser keeps the `not` marker deliberately. It used to be filtered out
  // as punctuation, which silently turned `not(1, 2)` into `1, 2` — every match
  // inverted, with no diagnostic.
  it('inverts a list of alternatives', () => {
    expect(test('not(1, 2)', toFeelNumber('1'))).toBe(false);
    expect(test('not(1, 2)', toFeelNumber('2'))).toBe(false);
    expect(test('not(1, 2)', toFeelNumber('3'))).toBe(true);
  });

  it('inverts a comparison', () => {
    expect(test('not(>= 750)', fico('800'))).toBe(false);
    expect(test('not(>= 750)', fico('700'))).toBe(true);
  });

  it('inverts an interval', () => {
    expect(test('not([700..750))', fico('720'))).toBe(false);
    expect(test('not([700..750))', fico('800'))).toBe(true);
  });

  it('leaves an undecidable test undecidable', () => {
    // Negating "could not tell" gives "could not tell", not "true".
    expect(test('not(>= 750)', null)).toBeNull();
  });
});

describe('undecidable entries', () => {
  it('yields null rather than false when the comparison is impossible', () => {
    // A null input cannot be ordered, and reporting false would be a claim the
    // engine cannot support.
    expect(test('>= 750', null)).toBeNull();
  });
});

describe('scope-sensitive compilation', () => {
  it('caches compiled tests per scope', () => {
    const first = engine.compileUnaryTests('>= 750');
    const second = engine.compileUnaryTests('>= 750');
    expect(second).toBe(first);
  });
});
