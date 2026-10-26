/**
 * Scope sensitivity.
 *
 * FEEL parsing depends on the declared name set: this is how names containing
 * spaces are recognized. The compiled expression cache must therefore
 * key on the ordered scope name set as well as the source.
 * These tests exist to stop that rule being "simplified" later.
 */

import { describe, expect, it } from 'vitest';

import { createFeelEngine } from '../src/engine.js';
import { feelNumberToString, isFeelNumber, toFeelNumber } from '../src/number.js';
import { scopeCacheKey } from '../src/parse.js';
import type { FeelContext } from '../src/values.js';

const engine = createFeelEngine();

const context: FeelContext = {
  'Applicant Data': { Age: toFeelNumber('30') },
  Applicant: { Data: toFeelNumber('7') },
  Data: toFeelNumber('5'),
};

describe('the same source parses differently under different scopes', () => {
  it('reads a spaced name as one variable when the scope declares it', () => {
    const compiled = engine.compileExpression('Applicant Data.Age', {
      names: ['Applicant Data'],
    });
    const value = compiled.evaluate(context).value;
    expect(isFeelNumber(value) ? feelNumberToString(value) : value).toBe('30');
  });

  it('reads the same source as a path when the scope declares the parts', () => {
    const compiled = engine.compileExpression('Applicant.Data', { names: ['Applicant'] });
    const value = compiled.evaluate(context).value;
    expect(isFeelNumber(value) ? feelNumberToString(value) : value).toBe('7');
  });
});

describe('cache keys', () => {
  it('distinguishes identical sources compiled under different scopes', () => {
    const wide = scopeCacheKey('Applicant Data', { names: ['Applicant Data'] }, 'Expression');
    const narrow = scopeCacheKey('Applicant Data', { names: ['Applicant'] }, 'Expression');
    expect(wide).not.toBe(narrow);
  });

  it('is stable regardless of the order names are declared in', () => {
    const first = scopeCacheKey('x', { names: ['a', 'b'] }, 'Expression');
    const second = scopeCacheKey('x', { names: ['b', 'a'] }, 'Expression');
    expect(first).toBe(second);
  });

  it('distinguishes expressions from unary tests', () => {
    expect(scopeCacheKey('1', { names: [] }, 'Expression')).not.toBe(
      scopeCacheKey('1', { names: [] }, 'UnaryTests'),
    );
  });
});

describe('compile once, evaluate many', () => {
  it('returns the same compiled handle for an identical source and scope', () => {
    const scope = { names: ['Applicant Data'] };
    expect(engine.compileExpression('Applicant Data.Age', scope)).toBe(
      engine.compileExpression('Applicant Data.Age', scope),
    );
  });

  it('produces identical results across repeated evaluation', () => {
    const compiled = engine.compileExpression('Applicant Data.Age + 1', {
      names: ['Applicant Data'],
    });

    const results = Array.from({ length: 5 }, () => {
      const value = compiled.evaluate(context).value;
      return isFeelNumber(value) ? feelNumberToString(value) : String(value);
    });

    expect(new Set(results)).toEqual(new Set(['31']));
  });
});
