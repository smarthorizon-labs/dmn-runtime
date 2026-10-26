/**
 * How a result node is judged.
 *
 * The ordering inside `judge` is load-bearing rather than incidental. Applying
 * the expected-error allowance before the unsupported-construct check once
 * reported 49.6% TCK coverage for an engine that evaluates a fraction of that,
 * because every unimplemented feature also returns null. These tests exist so
 * that mistake cannot recur silently.
 */

import { toFeelNumber, type Diagnostic, type FeelValue } from '@smarthorizon-labs/dmn-feel';
import { describe, expect, it } from 'vitest';

import { judge } from '../src/runner.js';
import type { WireValue } from '../src/wire.js';

const UNSUPPORTED: Diagnostic = {
  code: 'FEEL_UNSUPPORTED_CONSTRUCT',
  severity: 'WARNING',
  message: 'Unsupported FEEL construct: FunctionInvocation.',
};

function evaluationOf(options: {
  value: FeelValue;
  failed?: boolean;
  warnings?: readonly Diagnostic[];
}) {
  return {
    decisions: new Map([
      [
        'd',
        {
          name: 'd',
          value: options.value,
          failed: options.failed ?? false,
          messages: [],
          warnings: options.warnings ?? [],
        },
      ],
    ]),
    failed: options.failed ?? false,
  };
}

function resultNode(expected: WireValue, errorResult = false) {
  return { name: 'd', type: 'decision', errorResult, expected };
}

describe('expected errors', () => {
  const expectsError = resultNode({ type: 'null' }, true);

  it('accepts a decision that failed', () => {
    const outcome = judge(expectsError, evaluationOf({ value: null, failed: true }), undefined, undefined);
    expect(outcome.passed).toBe(true);
  });

  it('accepts a decision that evaluated to null', () => {
    // Under null propagation an error and a null are the same observation.
    const outcome = judge(expectsError, evaluationOf({ value: null }), undefined, undefined);
    expect(outcome.passed).toBe(true);
  });

  it('REJECTS a null that came from an unsupported construct', () => {
    // The regression that matters. Not evaluating something is not evidence
    // that it correctly produced no value.
    const outcome = judge(
      expectsError,
      evaluationOf({ value: null, warnings: [UNSUPPORTED] }),
      undefined,
      undefined,
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.category).toBe('UNSUPPORTED_CONSTRUCT');
  });

  it('reports a real value as an unexpected success', () => {
    const outcome = judge(
      expectsError,
      evaluationOf({ value: 'a value' }),
      undefined,
      undefined,
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.category).toBe('UNEXPECTED_SUCCESS');
  });
});

describe('expected values', () => {
  it('passes on a match', () => {
    const outcome = judge(
      resultNode({ type: 'string', value: 'ok' }),
      evaluationOf({ value: 'ok' }),
      undefined,
      undefined,
    );
    expect(outcome.passed).toBe(true);
  });

  it('reports a wrong value as a mismatch, not as unsupported', () => {
    const outcome = judge(
      resultNode({ type: 'string', value: 'ok' }),
      evaluationOf({ value: 'wrong' }),
      undefined,
      undefined,
    );
    expect(outcome.category).toBe('VALUE_MISMATCH');
  });

  it('attributes a wrong value to the unsupported construct that explains it', () => {
    const outcome = judge(
      resultNode({ type: 'string', value: 'ok' }),
      evaluationOf({ value: null, warnings: [UNSUPPORTED] }),
      undefined,
      undefined,
    );
    expect(outcome.category).toBe('UNSUPPORTED_CONSTRUCT');
  });

  it('compares decimals through the recorded-precision policy', () => {
    const outcome = judge(
      resultNode({ type: 'number', value: '2778.69354943277' }),
      evaluationOf({ value: toFeelNumber('2778.693549432766768088520383236299') }),
      undefined,
      undefined,
    );
    expect(outcome.passed).toBe(true);
  });
});

describe('inputs and values this runtime cannot represent', () => {
  it('reports an unrepresentable input before anything else', () => {
    const outcome = judge(resultNode({ type: 'null' }), undefined, 'when', undefined);
    expect(outcome.category).toBe('UNSUPPORTED_TYPE');
  });

  it('reports an unrepresentable expectation', () => {
    const outcome = judge(
      resultNode({ type: 'unsupported', detail: 'xsd:hexBinary' }),
      evaluationOf({ value: null }),
      undefined,
      undefined,
    );
    expect(outcome.category).toBe('UNSUPPORTED_TYPE');
  });

  it('reports a thrown error', () => {
    const outcome = judge(resultNode({ type: 'null' }), undefined, undefined, 'boom');
    expect(outcome.category).toBe('RUNTIME_ERROR');
  });
});
