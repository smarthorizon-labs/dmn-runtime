/**
 * Execution tracing.
 *
 * Original work. The runtime produces a
 * structured trace and prescribes no storage: a governance or audit platform
 * enriches and persists it (section 13.3).
 *
 * ## Values are opt-in, always
 *
 * A trace never automatically carries the input payload, and this is
 * where that is enforced. Recording values is a
 * decision the host makes per request, with a redaction policy attached; the
 * default records the *shape* of an evaluation — which decisions ran, in which
 * order, which rules matched, what failed — and none of the data flowing
 * through it.
 *
 * That default is deliberate. A trace of a lending decision is exactly the
 * record an auditor wants and exactly the record a data-protection officer
 * does not want written to a log by accident.
 *
 * ## Ordering
 *
 * Events carry a monotonic sequence number and are emitted in evaluation
 * order. Two runs of the same request produce the same events in the same
 * order; only the timestamps differ, and they are
 * metadata rather than anything a decision can observe.
 */

import { describeValue, feelTypeOf, type FeelValue } from '@smarthorizon-labs/dmn-feel';

/**
 * How much of an evaluation is recorded.
 *
 * Each level is a superset of the one before it.
 */
export type TraceLevel =
  /** Nothing. The tracer is not even constructed. */
  | 'NONE'
  /** Start and end of the evaluation, and its outcome. */
  | 'SUMMARY'
  /** Every decision evaluated, in dependency order, with its status. */
  | 'DECISIONS'
  /** Decision-table detail: which rules matched, and the hit policy applied. */
  | 'RULES'
  /** Everything, including function invocations. */
  | 'FULL';

const LEVEL_ORDER: Record<TraceLevel, number> = {
  NONE: 0,
  SUMMARY: 1,
  DECISIONS: 2,
  RULES: 3,
  FULL: 4,
};

/**
 * What a recorded value looks like.
 *
 * `omit` is the default: the trace says a value existed and what type it was,
 * never what it contained.
 */
export type ValuePolicy = 'omit' | 'type' | 'mask' | 'hash' | 'raw';

export interface RedactionPolicy {
  readonly values: ValuePolicy;
  /** Names always recorded raw, whatever `values` says. */
  readonly allow?: readonly string[];
  /** Names never recorded, whatever `values` says — checked before `allow`. */
  readonly deny?: readonly string[];
}

export const DEFAULT_REDACTION: RedactionPolicy = { values: 'omit' };

export interface TraceOptions {
  readonly level?: TraceLevel;
  readonly correlationId?: string;
  readonly redaction?: RedactionPolicy;
  /** Bound on recorded events. */
  readonly maxEvents?: number;
  /** Supplies timestamps. Injected so a test can pin them. */
  readonly now?: () => Date;
  /** Supplies the trace id. Injected for the same reason. */
  readonly traceId?: string;
}

export type TraceEventType =
  | 'evaluation-started'
  | 'evaluation-completed'
  | 'decision-started'
  | 'decision-completed'
  | 'decision-failed'
  | 'table-evaluated'
  | 'rule-matched'
  | 'hit-policy-applied'
  | 'function-invoked'
  | 'diagnostic';

export interface TraceEvent {
  /** Monotonic, from 1. Two runs of the same request agree on these. */
  readonly sequence: number;
  readonly type: TraceEventType;
  readonly at: string;
  readonly decision?: string;
  readonly decisionId?: string;
  readonly detail?: string;
  /** Present only when the redaction policy permits it. */
  readonly value?: string;
  readonly valueType?: string;
  readonly ruleIds?: readonly string[];
  readonly hitPolicy?: string;
  readonly durationMs?: number;
}

export interface DecisionTrace {
  readonly traceId: string;
  readonly correlationId?: string;
  readonly level: TraceLevel;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly events: readonly TraceEvent[];
  /** True when `maxEvents` cut the recording short. */
  readonly truncated: boolean;
  /** The policy in force, so a reader knows what the absence of a value means. */
  readonly redaction: RedactionPolicy;
}

/**
 * Collects trace events during one evaluation.
 *
 * A single instance belongs to a single request. It is not thread-safe and
 * does not need to be: evaluation is synchronous.
 */
export class Tracer {
  private readonly events: TraceEvent[] = [];
  private readonly level: TraceLevel;
  private readonly redaction: RedactionPolicy;
  private readonly maxEvents: number;
  private readonly clock: () => Date;
  private readonly startedAt: Date;
  private sequence = 0;
  private truncated = false;

  constructor(
    private readonly options: TraceOptions = {},
    private readonly id: string = options.traceId ?? nextTraceId(),
  ) {
    this.level = options.level ?? 'NONE';
    this.redaction = options.redaction ?? DEFAULT_REDACTION;
    this.maxEvents = options.maxEvents ?? 10_000;
    this.clock = options.now ?? (() => new Date());
    this.startedAt = this.clock();
  }

  get enabled(): boolean {
    return this.level !== 'NONE';
  }

  /** True when this level records the given detail. */
  records(level: TraceLevel): boolean {
    return LEVEL_ORDER[this.level] >= LEVEL_ORDER[level];
  }

  record(level: TraceLevel, event: Omit<TraceEvent, 'sequence' | 'at'>): void {
    if (!this.records(level)) {
      return;
    }

    if (this.events.length >= this.maxEvents) {
      this.truncated = true;
      return;
    }

    this.sequence += 1;
    this.events.push({ sequence: this.sequence, at: this.clock().toISOString(), ...event });
  }

  /**
   * Renders a value for the trace under the redaction policy.
   *
   * Returns the fields to spread into an event, which may be nothing at all.
   * Deny wins over allow, and allow wins over the default policy.
   */
  value(name: string | undefined, value: FeelValue): Pick<TraceEvent, 'value' | 'valueType'> {
    const deny = this.redaction.deny ?? [];
    const allow = this.redaction.allow ?? [];

    if (name !== undefined && deny.includes(name)) {
      return {};
    }

    const policy =
      name !== undefined && allow.includes(name) ? 'raw' : this.redaction.values;

    switch (policy) {
      case 'omit':
        return {};
      case 'type':
        return { valueType: feelTypeOf(value) };
      case 'mask':
        return { valueType: feelTypeOf(value), value: mask(value) };
      case 'hash':
        return { valueType: feelTypeOf(value), value: hash(describeValue(value)) };
      case 'raw':
        return { valueType: feelTypeOf(value), value: describeValue(value) };
    }
  }

  finish(): DecisionTrace {
    const completedAt = this.clock();

    return {
      traceId: this.id,
      ...(this.options.correlationId === undefined
        ? {}
        : { correlationId: this.options.correlationId }),
      level: this.level,
      startedAt: this.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - this.startedAt.getTime(),
      events: this.events,
      truncated: this.truncated,
      redaction: this.redaction,
    };
  }
}

/**
 * A tracer that records nothing.
 *
 * Used when tracing is off so the evaluator has no conditional to write, and
 * so the untraced path allocates nothing.
 */
export const NO_TRACE = new Tracer({ level: 'NONE' }, 'none');

function mask(value: FeelValue): string {
  if (value === null) return 'null';
  const rendered = describeValue(value);
  return rendered.length <= 2 ? '••' : `${rendered.slice(0, 1)}${'•'.repeat(Math.min(rendered.length - 1, 8))}`;
}

/**
 * A stable, non-reversible digest.
 *
 * FNV-1a rather than a cryptographic hash: the purpose is correlating equal
 * values across traces, not resisting an attacker with a dictionary. A trace
 * that needs the latter should not carry the value at all.
 */
function hash(text: string): string {
  let value = 0x811c9dc5;

  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }

  return `fnv1a:${value.toString(16).padStart(8, '0')}`;
}

let traceCounter = 0;

/**
 * Sequential rather than random.
 *
 * `Math.random` would make the engine non-deterministic, which the
 * design rules out, and a host that wants a UUID supplies one through
 * `traceId`.
 */
function nextTraceId(): string {
  traceCounter += 1;
  return `trace-${String(traceCounter).padStart(6, '0')}`;
}
