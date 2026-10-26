/**
 * Every example, asserted.
 *
 * Examples that are not executed by the test suite decay silently: a semantic
 * change lands, the README keeps claiming an output nobody re-ran, and the
 * first person to try it loses an afternoon. These run on every `npm test`.
 *
 * They also serve as an end-to-end check that is independent of the TCK — real
 * models in the shapes people actually write, rather than conformance probes.
 */

import { describeValue } from '@smarthorizon-labs/dmn-feel';
import { describe, expect, it } from 'vitest';

// @ts-expect-error -- the examples are plain JavaScript on purpose, so that
// they can be copied into a project without a build step.
import { loadExample, runCase, scenarios } from './harness.mjs';

const names = Object.keys(scenarios as Record<string, unknown>);

it('has ten models plus one alternative invocation', () => {
  expect(names).toHaveLength(11);
});

describe.each(names)('%s', (name: string) => {
  const { scenario, model, compiled } = loadExample(name);

  it('is a DMN 1.5 model that compiles without diagnostics', () => {
    expect(model.dmnVersion).toBe('1.5');
    expect(compiled.diagnostics).toEqual([]);
  });

  for (const testCase of scenario.cases) {
    it(testCase.name, () => {
      const { values } = runCase(compiled, scenario, testCase);

      for (const [decision, expected] of Object.entries(testCase.expect)) {
        expect(describeValue(values[decision] ?? null), decision).toBe(expected);
      }
    });
  }

  it('reports no unevaluated construct in any case', () => {
    // An example that silently relies on something the engine cannot evaluate
    // would be teaching the wrong thing.
    for (const testCase of scenario.cases) {
      const { result } = runCase(compiled, scenario, testCase);

      for (const [decisionName, decision] of result.decisions) {
        const unevaluated = decision.warnings.filter(
          (warning: { code: string }) =>
            warning.code === 'FEEL_UNSUPPORTED_CONSTRUCT' ||
            warning.code === 'FEEL_UNKNOWN_FUNCTION',
        );

        expect(unevaluated.map((warning: { message: string }) => warning.message), decisionName)
          .toEqual([]);
      }
    }
  });
});

describe('tracing an example', () => {
  it('records the rules that produced a fraud disposition', () => {
    const { scenario, compiled } = loadExample('08-fraud-risk');
    const structuring = scenario.cases[2];

    const { result } = runCase(compiled, scenario, structuring, { level: 'RULES' });

    const matched = result.trace.events
      .filter((event: { type: string }) => event.type === 'rule-matched')
      .flatMap((event: { ruleIds?: string[] }) => event.ruleIds ?? []);

    // The disposition is explainable: these are the rules an analyst would be
    // shown, and none of the cardholder's data is in the trace.
    expect(matched).toContain('_rd_critical');
    expect(matched).toContain('_rb_critical');

    for (const event of result.trace.events) {
      expect(event.value).toBeUndefined();
    }
  });
});
