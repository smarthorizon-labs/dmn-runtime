/**
 * The FEEL adapter's public contract.
 *
 * Original work. The interface is two-stage
 * by design: `compile*` parses once at model-compile time, and the returned
 * handle evaluates many times without re-parsing. A string-in interface cannot
 * compile once — a thousand-rule decision table would
 * re-parse thousands of expressions on every request.
 */

import type { SyntaxNode } from '@lezer/common';

import type { Diagnostic } from './diagnostics.js';
import { Evaluator } from './evaluate.js';
import { EMPTY_SCOPE, parseFeel, scopeCacheKey, type FeelScope } from './parse.js';
import { evaluateUnaryTests } from './unary-tests.js';
import type { FeelContext, FeelValue } from './values.js';

export interface FeelEvaluation<T = FeelValue> {
  readonly value: T | null;
  readonly warnings: readonly Diagnostic[];
}

export interface FeelEngineInfo {
  readonly adapterVersion: string;
  readonly grammar: string;
  readonly decimalLibrary: string;
  /** There is one numeric semantics; see docs/adr/0001-numeric-semantics.md. */
  readonly numericSemantics: 'DECIMAL128';
  readonly precision: 34;
  readonly rounding: 'HALF_EVEN';
}

export interface CompiledFeelExpression {
  readonly source: string;
  /** Parse-stage problems. A non-empty list means the expression is invalid. */
  readonly diagnostics: readonly Diagnostic[];
  /** Pure, synchronous, reusable, and safe to call concurrently. */
  evaluate(context: FeelContext): FeelEvaluation;
}

export interface CompiledFeelUnaryTests {
  readonly source: string;
  readonly diagnostics: readonly Diagnostic[];
  test(value: FeelValue, context: FeelContext): FeelEvaluation<boolean>;
}

export interface FeelEngine {
  compileExpression(source: string, scope?: FeelScope): CompiledFeelExpression;
  compileUnaryTests(source: string, scope?: FeelScope): CompiledFeelUnaryTests;
  readonly info: FeelEngineInfo;
}

const ENGINE_INFO: FeelEngineInfo = {
  adapterVersion: '0.1.0',
  grammar: 'lezer-feel',
  decimalLibrary: 'decimal.js',
  numericSemantics: 'DECIMAL128',
  precision: 34,
  rounding: 'HALF_EVEN',
};

export interface FeelEngineOptions {
  /**
   * Bound on the compiled-expression cache. Entries are keyed on source,
   * dialect and the ordered scope name set — never on source alone, because
   * parsing is scope-sensitive.
   */
  readonly cacheSize?: number;
}

export function createFeelEngine(options: FeelEngineOptions = {}): FeelEngine {
  const cacheSize = options.cacheSize ?? 500;
  const expressions = new Map<string, CompiledFeelExpression>();
  const unaryTests = new Map<string, CompiledFeelUnaryTests>();

  function remember<T>(cache: Map<string, T>, key: string, build: () => T): T {
    const existing = cache.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const built = build();

    if (cache.size >= cacheSize) {
      const oldest = cache.keys().next();
      if (!oldest.done) {
        cache.delete(oldest.value);
      }
    }

    cache.set(key, built);
    return built;
  }

  return {
    info: ENGINE_INFO,

    compileExpression(source, scope = EMPTY_SCOPE) {
      return remember(expressions, scopeCacheKey(source, scope, 'Expression'), () =>
        compileExpression(source, scope),
      );
    },

    compileUnaryTests(source, scope = EMPTY_SCOPE) {
      return remember(unaryTests, scopeCacheKey(source, scope, 'UnaryTests'), () =>
        compileUnaryTests(source, scope),
      );
    },
  };
}

function compileExpression(source: string, scope: FeelScope): CompiledFeelExpression {
  const { tree, diagnostics } = parseFeel(source, scope, 'Expression');
  const root: SyntaxNode = tree.topNode;
  const valid = diagnostics.length === 0;

  return {
    source,
    diagnostics,
    evaluate(context) {
      if (!valid) {
        return { value: null, warnings: diagnostics };
      }
      return Evaluator.run(source, root, context);
    },
  };
}

function compileUnaryTests(source: string, scope: FeelScope): CompiledFeelUnaryTests {
  const { tree, diagnostics } = parseFeel(source, scope, 'UnaryTests');
  const root: SyntaxNode = tree.topNode;
  const valid = diagnostics.length === 0;

  return {
    source,
    diagnostics,
    test(value, context) {
      if (!valid) {
        return { value: null, warnings: diagnostics };
      }
      return evaluateUnaryTests(Evaluator.run, source, root, value, context);
    },
  };
}
