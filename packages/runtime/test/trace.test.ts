/**
 * Execution tracing.
 *
 * The behaviour that matters most here is what a trace does *not* contain.
 * Input data must never reach a trace unless the host asks for it, and
 * these tests are what stop that default eroding.
 */

import { toFeelNumber } from '@smarthorizon-labs/dmn-feel';
import { loadDmnXml } from '@smarthorizon-labs/dmn-xml';
import { describe, expect, it } from 'vitest';

import { compileModel } from '../src/compile.js';
import { evaluateModel } from '../src/evaluate.js';
import type { TraceEvent, TraceLevel } from '../src/trace.js';

const model = loadDmnXml(
  `<definitions xmlns="https://www.omg.org/spec/DMN/20230324/MODEL/" namespace="urn:t" name="Lending">
     <inputData name="score" id="_score"><variable name="score" typeRef="number"/></inputData>
     <decision name="Band" id="_band">
       <variable name="Band" typeRef="string"/>
       <informationRequirement><requiredInput href="#_score"/></informationRequirement>
       <decisionTable hitPolicy="FIRST" id="_dt">
         <input><inputExpression><text>score</text></inputExpression></input>
         <output/>
         <rule id="r1">
           <inputEntry><text>&gt;= 700</text></inputEntry>
           <outputEntry><text>"good"</text></outputEntry>
         </rule>
         <rule id="r2">
           <inputEntry><text>-</text></inputEntry>
           <outputEntry><text>"poor"</text></outputEntry>
         </rule>
       </decisionTable>
     </decision>
     <decision name="Outcome" id="_outcome">
       <variable name="Outcome" typeRef="string"/>
       <informationRequirement><requiredDecision href="#_band"/></informationRequirement>
       <literalExpression><text>"band is " + Band</text></literalExpression>
     </decision>
   </definitions>`,
);

const compiled = compileModel(model);

/** A fixed clock, so timestamps are assertable rather than incidental. */
function fixedClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++));
}

function trace(level: TraceLevel, extra: Record<string, unknown> = {}) {
  const result = evaluateModel(
    compiled,
    { score: toFeelNumber('720') },
    { trace: { level, traceId: 'fixed', now: fixedClock(), ...extra } },
  );
  return result.trace;
}

function types(events: readonly TraceEvent[]): string[] {
  return events.map((event) => event.type);
}

describe('trace levels', () => {
  it('produces no trace at all when tracing is not requested', () => {
    expect(evaluateModel(compiled, { score: toFeelNumber('720') }).trace).toBeUndefined();
  });

  it('records only start and end at SUMMARY', () => {
    expect(types(trace('SUMMARY')?.events ?? [])).toEqual([
      'evaluation-started',
      'evaluation-completed',
    ]);
  });

  it('records every decision, in dependency order, at DECISIONS', () => {
    const events = trace('DECISIONS')?.events ?? [];
    const decisions = events
      .filter((event) => event.type === 'decision-completed')
      .map((event) => event.decision);

    // Band must precede Outcome, because Outcome requires it.
    expect(decisions).toEqual(['Band', 'Outcome']);
  });

  it('records matched rules and the hit policy at RULES', () => {
    const events = trace('RULES')?.events ?? [];
    const matched = events.filter((event) => event.type === 'rule-matched');

    expect(matched).toHaveLength(1);
    expect(matched[0]?.ruleIds).toEqual(['r1']);
    expect(matched[0]?.decision).toBe('Band');

    const applied = events.find((event) => event.type === 'hit-policy-applied');
    expect(applied?.hitPolicy).toBe('FIRST');
  });

  it('carries the decision id alongside the name, for stable references', () => {
    const started = (trace('DECISIONS')?.events ?? []).find(
      (event) => event.type === 'decision-started',
    );
    expect(started?.decisionId).toBe('_band');
  });
});

describe('values are opt-in', () => {
  it('records no values by default', () => {
    // The default a careless integrator gets. A lending decision's inputs must
    // not reach a log because someone turned tracing on.
    const events = trace('FULL')?.events ?? [];

    for (const event of events) {
      expect(event.value).toBeUndefined();
      expect(event.valueType).toBeUndefined();
    }
  });

  it('records the type, but not the value, under the type policy', () => {
    const events = trace('FULL', { redaction: { values: 'type' } })?.events ?? [];
    const band = events.find((event) => event.decision === 'Band' && event.valueType !== undefined);

    expect(band?.valueType).toBe('string');
    expect(band?.value).toBeUndefined();
  });

  it('masks values when asked', () => {
    const events = trace('FULL', { redaction: { values: 'mask' } })?.events ?? [];
    const band = events.find((event) => event.decision === 'Band' && event.value !== undefined);

    expect(band?.value).not.toContain('good');
    expect(band?.value).toContain('•');
  });

  it('hashes values stably, so equal values correlate across traces', () => {
    const first = trace('FULL', { redaction: { values: 'hash' } })?.events ?? [];
    const second = trace('FULL', { redaction: { values: 'hash' } })?.events ?? [];

    const digestOf = (events: readonly TraceEvent[]) =>
      events.find((event) => event.decision === 'Band' && event.value !== undefined)?.value;

    expect(digestOf(first)).toMatch(/^fnv1a:/u);
    expect(digestOf(first)).toBe(digestOf(second));
    expect(digestOf(first)).not.toContain('good');
  });

  it('records raw values only when explicitly asked', () => {
    const events = trace('FULL', { redaction: { values: 'raw' } })?.events ?? [];
    const band = events.find((event) => event.decision === 'Band' && event.value !== undefined);

    expect(band?.value).toBe('"good"');
  });

  it('lets a field be allowlisted against the default', () => {
    const events =
      trace('FULL', { redaction: { values: 'omit', allow: ['Band'] } })?.events ?? [];
    const band = events.find((event) => event.decision === 'Band' && event.value !== undefined);

    expect(band?.value).toBe('"good"');
  });

  it('lets a field be denied even under a raw policy', () => {
    // Deny beats allow and beats the policy: there is no combination of
    // settings that leaks a denied field.
    const events =
      trace('FULL', { redaction: { values: 'raw', allow: ['Band'], deny: ['Band'] } })?.events ??
      [];

    for (const event of events.filter((candidate) => candidate.decision === 'Band')) {
      expect(event.value).toBeUndefined();
    }
  });

  it('reports the policy in force, so an absent value is unambiguous', () => {
    expect(trace('FULL')?.redaction.values).toBe('omit');
  });
});

describe('trace shape', () => {
  it('numbers events monotonically from one', () => {
    const events = trace('RULES')?.events ?? [];
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
  });

  it('produces the same events in the same order across runs', () => {
    // Only timestamps may differ between two runs of one request.
    expect(types(trace('RULES')?.events ?? [])).toEqual(types(trace('RULES')?.events ?? []));
  });

  it('carries identity and timing', () => {
    const result = trace('SUMMARY', { correlationId: 'case-42' });

    expect(result?.traceId).toBe('fixed');
    expect(result?.correlationId).toBe('case-42');
    expect(result?.startedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('truncates rather than growing without bound', () => {
    // A trace is a resource like any other.
    const result = trace('RULES', { maxEvents: 2 });

    expect(result?.events).toHaveLength(2);
    expect(result?.truncated).toBe(true);
  });

  it('records a failing decision as failed, with the reason', () => {
    const broken = compileModel(
      loadDmnXml(
        `<definitions xmlns="https://www.omg.org/spec/DMN/20230324/MODEL/" namespace="urn:t" name="t">
           <decision name="d" id="_d">
             <variable name="d"/>
             <decisionTable hitPolicy="UNIQUE">
               <input><inputExpression><text>1</text></inputExpression></input>
               <output/>
               <rule><inputEntry><text>-</text></inputEntry><outputEntry><text>"a"</text></outputEntry></rule>
               <rule><inputEntry><text>-</text></inputEntry><outputEntry><text>"b"</text></outputEntry></rule>
             </decisionTable>
           </decision>
         </definitions>`,
      ),
    );

    const result = evaluateModel(broken, {}, { trace: { level: 'DECISIONS' } });
    const failed = result.trace?.events.find((event) => event.type === 'decision-failed');

    expect(failed?.decision).toBe('d');
    expect(failed?.detail).toMatch(/UNIQUE hit policy matched 2 rules/u);
  });
});
