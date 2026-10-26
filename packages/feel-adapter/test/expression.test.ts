import { describe, expect, it } from 'vitest';

import { createFeelEngine } from '../src/engine.js';
import { feelNumberToString, isFeelNumber, toFeelNumber } from '../src/number.js';
import { isFeelFunction } from '../src/values.js';
import type { FeelScope } from '../src/parse.js';
import type { FeelContext, FeelValue } from '../src/values.js';

const engine = createFeelEngine();

function evaluate(source: string, context: FeelContext = {}, scope?: FeelScope) {
  const compiled = engine.compileExpression(source, scope);
  expect(compiled.diagnostics).toEqual([]);
  return compiled.evaluate(context).value;
}

function text(value: FeelValue): string {
  return isFeelNumber(value) ? feelNumberToString(value) : String(value);
}

describe('literals', () => {
  it('evaluates numbers, strings, booleans and null', () => {
    expect(text(evaluate('42'))).toBe('42');
    expect(evaluate('"hello"')).toBe('hello');
    expect(evaluate('true')).toBe(true);
    expect(evaluate('false')).toBe(false);
    expect(evaluate('null')).toBeNull();
  });

  it('decodes string escapes', () => {
    expect(evaluate('"a\\nb"')).toBe('a\nb');
    expect(evaluate('"say \\"hi\\""')).toBe('say "hi"');
  });

  it('evaluates negative and exponential literals', () => {
    expect(text(evaluate('-5'))).toBe('-5');
    expect(text(evaluate('1.5e3'))).toBe('1500');
  });
});

describe('arithmetic', () => {
  it('respects operator precedence and grouping', () => {
    expect(text(evaluate('2 + 3 * 4'))).toBe('14');
    expect(text(evaluate('(2 + 3) * 4'))).toBe('20');
  });

  it('evaluates exponentiation', () => {
    expect(text(evaluate('2 ** 10'))).toBe('1024');
  });

  it('concatenates strings with +', () => {
    expect(evaluate('"foo" + "bar"')).toBe('foobar');
  });

  it('yields null for arithmetic over a non-number', () => {
    expect(evaluate('1 + "a"')).toBeNull();
    expect(evaluate('1 + null')).toBeNull();
  });

  it('yields null for division by zero', () => {
    expect(evaluate('1 / 0')).toBeNull();
  });
});

describe('comparison', () => {
  it('orders numbers and strings', () => {
    expect(evaluate('1 < 2')).toBe(true);
    expect(evaluate('2 <= 2')).toBe(true);
    expect(evaluate('3 > 4')).toBe(false);
    expect(evaluate('"a" < "b"')).toBe(true);
  });

  it('compares decimals exactly', () => {
    expect(evaluate('0.1 + 0.2 = 0.3')).toBe(true);
  });

  it('tests equality structurally', () => {
    expect(evaluate('[1, 2] = [1, 2]')).toBe(true);
    expect(evaluate('[1, 2] = [2, 1]')).toBe(false);
    expect(evaluate('null = null')).toBe(true);
    expect(evaluate('1 != 2')).toBe(true);
  });

  describe('three-valued equality', () => {
    // Every case below is taken from DMN TCK 0068-feel-equality and was
    // confirmed against Drools 10.2.0 by the differential harness.

    it('decides comparisons against null rather than returning null', () => {
      expect(evaluate('null = null')).toBe(true);
      expect(evaluate('null != null')).toBe(false);
      expect(evaluate('true = null')).toBe(false);
      expect(evaluate('false = null')).toBe(false);
      expect(evaluate('100 = null')).toBe(false);
      expect(evaluate('"foo" = null')).toBe(false);
    });

    it('returns null when the operands are of different types', () => {
      // Not false: the values are incomparable, and saying false would claim
      // knowledge the engine does not have.
      expect(evaluate('true = 1')).toBeNull();
      expect(evaluate('false = 0')).toBeNull();
      expect(evaluate('100 = "100"')).toBeNull();
      expect(evaluate('"foo" = 100')).toBeNull();
      expect(evaluate('[] = 0')).toBeNull();
    });

    it('propagates null through !=', () => {
      expect(evaluate('100 != "100"')).toBeNull();
    });

    it('still compares same-typed values normally', () => {
      expect(evaluate('123 = 123')).toBe(true);
      expect(evaluate('0 = 0.00')).toBe(true);
      expect(evaluate('-0 = 0')).toBe(true);
      expect(evaluate('12300 = 1.23e4')).toBe(true);
      expect(evaluate('0.000123 = 1.23e-4')).toBe(true);
      expect(evaluate('"foo" = "Foo"')).toBe(false);
      expect(evaluate('[1,1,1] = [1,1,1,1]')).toBe(false);
      expect(evaluate('[] = []')).toBe(true);
    });

    it('returns null when a list differs only by an undecidable element', () => {
      // Same type, same length, one incomparable pair.
      expect(evaluate('[1] = ["a"]')).toBeNull();
      // A definite mismatch earlier in the list decides first.
      expect(evaluate('[9, 1] = [8, "a"]')).toBe(false);
    });
  });

  it('yields null when operands are not comparable', () => {
    expect(evaluate('1 < "a"')).toBeNull();
  });
});

describe('three-valued boolean logic', () => {
  it('lets false dominate conjunction', () => {
    expect(evaluate('true and false')).toBe(false);
    expect(evaluate('false and null')).toBe(false);
    expect(evaluate('true and true')).toBe(true);
    expect(evaluate('true and null')).toBeNull();
  });

  it('lets true dominate disjunction', () => {
    expect(evaluate('true or false')).toBe(true);
    expect(evaluate('null or true')).toBe(true);
    expect(evaluate('false or false')).toBe(false);
    expect(evaluate('false or null')).toBeNull();
  });
});

describe('conditionals', () => {
  it('selects a branch on a boolean condition', () => {
    expect(evaluate('if 1 < 2 then "yes" else "no"')).toBe('yes');
    expect(evaluate('if 1 > 2 then "yes" else "no"')).toBe('no');
  });

  it('selects the else branch when the condition is not boolean', () => {
    expect(evaluate('if null then "yes" else "no"')).toBe('no');
  });
});

describe('names and paths', () => {
  const scope: FeelScope = { names: ['Applicant Data', 'Credit Score'] };
  const context: FeelContext = {
    'Applicant Data': { Monthly: { Income: toFeelNumber('5000') } },
    'Credit Score': { FICO: toFeelNumber('720') },
  };

  it('resolves a name containing spaces through a path', () => {
    expect(text(evaluate('Applicant Data.Monthly.Income', context, scope))).toBe('5000');
  });

  it('computes over a resolved path', () => {
    expect(text(evaluate('Applicant Data.Monthly.Income * 0.28', context, scope))).toBe('1400');
  });

  it('yields null for a missing path segment', () => {
    expect(evaluate('Applicant Data.Monthly.Bonus', context, scope)).toBeNull();
  });

  it('yields null, with a warning, for an unknown name', () => {
    const compiled = engine.compileExpression('Unknown Thing', { names: ['Unknown Thing'] });
    const outcome = compiled.evaluate({});
    expect(outcome.value).toBeNull();
    expect(outcome.warnings.map((warning) => warning.code)).toContain('FEEL_UNKNOWN_VARIABLE');
  });

  it('refuses to resolve prototype-bearing property names', () => {
    expect(evaluate('Credit Score.constructor', context, scope)).toBeNull();
  });
});

describe('lists', () => {
  it('builds a list of evaluated items', () => {
    const value = evaluate('[1, 2, 3]');
    expect(Array.isArray(value)).toBe(true);
    expect((value as readonly FeelValue[]).map(text)).toEqual(['1', '2', '3']);
  });
});

describe('context literals', () => {
  it('builds a context from its entries', () => {
    expect(evaluate('{a: 1, b: "x"}')).toEqual({ a: toFeelNumber('1'), b: 'x' });
  });

  it('lets an entry see the entries before it', () => {
    const value = evaluate('{a: 1, b: a + 1}') as Record<string, FeelValue>;
    expect(text(value['b'] ?? null)).toBe('2');
  });

  it('accepts a quoted key', () => {
    expect(evaluate('{"a b": 1}')).toEqual({ 'a b': toFeelNumber('1') });
  });

  it('reads an entry back through a path', () => {
    expect(text(evaluate('{a: {b: 7}}.a.b'))).toBe('7');
  });

  it('yields an empty context for no entries', () => {
    expect(evaluate('{}')).toEqual({});
  });

  it('refuses a prototype-bearing key', () => {
    // Model content must not reach object internals.
    const outcome = engine.compileExpression('{__proto__: 1}').evaluate({});
    expect(outcome.warnings.map((warning) => warning.code)).toContain(
      'FEEL_UNSUPPORTED_CONSTRUCT',
    );
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('instance of', () => {
  it('decides the types it can check', () => {
    expect(evaluate('1 instance of number')).toBe(true);
    expect(evaluate('"a" instance of string')).toBe(true);
    expect(evaluate('true instance of boolean')).toBe(true);
    expect(evaluate('[1] instance of list')).toBe(true);
    expect(evaluate('{a: 1} instance of context')).toBe(true);
  });

  it('returns false for a type the value does not belong to', () => {
    expect(evaluate('1 instance of string')).toBe(false);
    expect(evaluate('"a" instance of number')).toBe(false);
  });

  it('treats every value as an instance of Any', () => {
    expect(evaluate('null instance of Any')).toBe(true);
    expect(evaluate('1 instance of Any')).toBe(true);
  });

  it('reports a type it cannot decide rather than guessing', () => {
    // A confident wrong answer here silently changes control flow.
    const outcome = engine.compileExpression('1 instance of date').evaluate({});
    expect(outcome.value).toBeNull();
    expect(outcome.warnings.map((warning) => warning.code)).toContain(
      'FEEL_UNSUPPORTED_CONSTRUCT',
    );
  });
});

describe('between', () => {
  it('tests an inclusive range', () => {
    expect(evaluate('5 between 1 and 10')).toBe(true);
    expect(evaluate('1 between 1 and 10')).toBe(true);
    expect(evaluate('10 between 1 and 10')).toBe(true);
    expect(evaluate('11 between 1 and 10')).toBe(false);
  });

  it('works on strings', () => {
    expect(evaluate('"c" between "a" and "e"')).toBe(true);
  });

  it('yields null when a bound is not comparable', () => {
    expect(evaluate('5 between 1 and "x"')).toBeNull();
    expect(evaluate('null between 1 and 10')).toBeNull();
  });
});

describe('in', () => {
  it('tests membership of a list', () => {
    expect(evaluate('1 in [2, 3, 1]')).toBe(true);
    expect(evaluate('1 in [2, 3, 4]')).toBe(false);
  });

  it('tests containment in a range', () => {
    expect(evaluate('3 in (1..5)')).toBe(true);
    expect(evaluate('1 in (1..5)')).toBe(false);
    expect(evaluate('1 in [1..5]')).toBe(true);
  });

  it('applies a list of unary tests, any of which may match', () => {
    expect(evaluate('1 in (<5, >10)')).toBe(true);
    expect(evaluate('7 in (<5, >10)')).toBe(false);
    expect(evaluate('11 in (<5, >10)')).toBe(true);
  });

  it('tests equality against a single value', () => {
    expect(evaluate('1 in 1')).toBe(true);
    expect(evaluate('1 in 2')).toBe(false);
  });
});

describe('not', () => {
  it('negates a boolean and yields null for anything else', () => {
    expect(evaluate('not(true)')).toBe(false);
    expect(evaluate('not(false)')).toBe(true);
    expect(evaluate('not(null)')).toBeNull();
    expect(evaluate('not(1)')).toBeNull();
  });

  it('is shadowed by a variable of the same name', () => {
    // FEEL scoping: the context wins over the built-in.
    expect(evaluate('not', { not: 'shadowed' }, { names: ['not'] })).toBe('shadowed');
  });
});

describe('external function bindings', () => {
  it('refuses to build a callable, and does not leak the descriptor as data', () => {
    // `external` is the FEEL spelling of functionKind="Java".
    // Returning the `{java: {...}}` context would be worse than refusing: the
    // model asked for a function and would silently receive a map.
    const outcome = engine
      .compileExpression('function(c) external {java: {class: "java.lang.String"}}')
      .evaluate({});

    expect(outcome.value).toBeNull();
    expect(outcome.warnings.map((warning) => warning.code)).toContain(
      'FEEL_UNSUPPORTED_CONSTRUCT',
    );
  });
});

describe('functions', () => {
  const scope: FeelScope = { names: ['double', 'greet'] };

  function twice(): FeelValue {
    return {
      kind: 'function',
      name: 'double',
      parameters: ['n'],
      invoke: (args) => {
        const value = args[0];
        return isFeelNumber(value) ? value.times(2) : null;
      },
    };
  }

  it('invokes a function positionally', () => {
    expect(text(evaluate('double(21)', { double: twice() }, scope))).toBe('42');
  });

  it('invokes a function by parameter name', () => {
    expect(text(evaluate('double(n: 21)', { double: twice() }, scope))).toBe('42');
  });

  it('passes null for a parameter with no argument', () => {
    expect(evaluate('double()', { double: twice() }, scope)).toBeNull();
  });

  it('defines and applies an inline function', () => {
    expect(isFeelFunction(evaluate('function(a, b) a + b'))).toBe(true);
    expect(text(evaluate('(function(a, b) a + b)(1, 2)'))).toBe('3');
  });

  it('gives an inline function its defining scope', () => {
    expect(text(evaluate('(function(a) a + greet)(1)', { greet: toFeelNumber('9') }, scope))).toBe(
      '10',
    );
  });

  it('reports an unknown function distinctly from an unknown variable', () => {
    // A missing built-in means the expression was not evaluated. Reporting it
    // as an ordinary null would let unimplemented functions look like correct
    // null results.
    const outcome = engine.compileExpression('matches("a", "b")').evaluate({});
    expect(outcome.value).toBeNull();
    expect(outcome.warnings.map((warning) => warning.code)).toContain('FEEL_UNKNOWN_FUNCTION');
  });

  it('stops runaway recursion instead of exhausting the stack', () => {
    // The limit is what turns a host crash into a diagnostic.
    // The warning surfaces in the innermost evaluation, so this asserts the
    // observable guarantee — it terminates and yields null rather than
    // throwing. A self-recursive BKM, where the plumbing does propagate the
    // diagnostic, is covered in the runtime package.
    const compiled = engine.compileExpression('loop()', { names: ['loop'] });

    const recursive: FeelValue = {
      kind: 'function',
      name: 'loop',
      parameters: [],
      invoke: () => compiled.evaluate({ loop: recursive }).value,
    };

    expect(() => compiled.evaluate({ loop: recursive })).not.toThrow();
    expect(compiled.evaluate({ loop: recursive }).value).toBeNull();
  });
});

describe('diagnostics', () => {
  it('reports a syntax error at compile time, not per request', () => {
    const compiled = engine.compileExpression('1 +');
    expect(compiled.diagnostics).toHaveLength(1);
    expect(compiled.diagnostics[0]?.code).toBe('FEEL_PARSE_ERROR');
    expect(compiled.diagnostics[0]?.severity).toBe('ERROR');
  });

  it('reports an empty expression', () => {
    expect(engine.compileExpression('   ').diagnostics[0]?.code).toBe('FEEL_EMPTY_EXPRESSION');
  });

  it('carries a source position', () => {
    const compiled = engine.compileExpression('1 +\n2 +');
    const span = compiled.diagnostics[0]?.source;
    expect(span?.line).toBeGreaterThanOrEqual(1);
    expect(span?.startOffset).toBeGreaterThanOrEqual(0);
  });

  it('reports a built-in it does not provide rather than guessing', () => {
    const outcome = engine.compileExpression('sort([2, 1])').evaluate({});
    expect(outcome.value).toBeNull();
    expect(outcome.warnings.map((warning) => warning.code)).toContain(
      'FEEL_UNKNOWN_FUNCTION',
    );
  });
});

describe('engine info', () => {
  it('reports the numeric semantics in force', () => {
    expect(engine.info.numericSemantics).toBe('DECIMAL128');
    expect(engine.info.precision).toBe(34);
    expect(engine.info.rounding).toBe('HALF_EVEN');
  });
});
