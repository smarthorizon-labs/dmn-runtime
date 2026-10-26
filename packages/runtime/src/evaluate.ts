/**
 * Decision evaluation.
 *
 * Original work. Evaluation is
 * pure and synchronous: no I/O occurs after compilation.
 *
 * Failure semantics are `propagate-null` (ADR-0005): a decision that cannot be
 * evaluated yields null, and dependents evaluate with that null rather than the
 * whole request aborting. Which decisions failed on their own terms, and which
 * merely inherited a null, is recorded separately.
 */

import {
  arithmetic,
  isFeelFunction,
  isFeelList,
  feelEquals,
  feelCompare,
  isFeelNumber,
  feelTypeOf,
  toFeelNumber,
  type Diagnostic,
  type FeelContext,
  type FeelFunction,
  type FeelValue,
} from '@smarthorizon-labs/dmn-feel';

import type {
  CompiledDecision,
  CompiledDecisionService,
  CompiledDmnModel,
  CompiledExpression,
  CompiledFunction,
  CompiledRule,
  CompiledTable,
  ScalarType,
  TypeShape,
} from './compile.js';
import { NO_TRACE, Tracer, type DecisionTrace, type TraceOptions } from './trace.js';

export interface DecisionResult {
  readonly name: string;
  readonly value: FeelValue;
  readonly failed: boolean;
  readonly messages: readonly string[];
  readonly warnings: readonly Diagnostic[];
}

export interface EvaluationResult {
  readonly decisions: ReadonlyMap<string, DecisionResult>;
  readonly failed: boolean;
  /**
   * The composed result of a decision-service invocation: the single output
   * decision's value, or a context keyed by output-decision name. Absent for
   * whole-model evaluation, where `decisions` is the result.
   */
  readonly value?: FeelValue;
  /** Request-level problems, such as inputs the service does not declare. */
  readonly warnings?: readonly string[];
  /** Present when tracing was requested. */
  readonly trace?: DecisionTrace;
}

export interface EvaluateOptions {
  readonly trace?: TraceOptions;
}

interface Outcome {
  value: FeelValue;
  failed: boolean;
  messages: string[];
  warnings: Diagnostic[];
}

function ok(value: FeelValue): Outcome {
  return { value, failed: false, messages: [], warnings: [] };
}

function failure(message: string): Outcome {
  return { value: null, failed: true, messages: [message], warnings: [] };
}

/**
 * Evaluates every decision in the model, in dependency order.
 *
 * This is the whole-model form the TCK exercises; a request naming a single
 * decision evaluates the same graph and reads one result out of it.
 */
export function evaluateModel(
  compiled: CompiledDmnModel,
  inputs: FeelContext,
  options: EvaluateOptions = {},
): EvaluationResult {
  const tracer = options.trace === undefined ? NO_TRACE : new Tracer(options.trace);
  tracer.record('SUMMARY', { type: 'evaluation-started', detail: compiled.model.name ?? '' });

  const results = new Map<string, DecisionResult>();
  // A null-prototype accumulator: names come from the model.
  const context: Record<string, FeelValue> = Object.create(null) as Record<string, FeelValue>;

  for (const [name, value] of Object.entries(inputs)) {
    context[name] = value;
  }

  const sink: Diagnostic[] = [];
  bindKnowledgeModels(compiled, context, sink);

  for (const id of compiled.order) {
    const decision = compiled.decisions.get(id);
    if (decision === undefined) {
      continue;
    }

    results.set(decision.name, evaluateOne(decision, context, sink, tracer));
  }

  const failed = [...results.values()].some((result) => result.failed);
  tracer.record('SUMMARY', {
    type: 'evaluation-completed',
    detail: failed ? 'FAILED' : 'SUCCEEDED',
  });

  return {
    decisions: results,
    failed,
    ...(tracer.enabled ? { trace: tracer.finish() } : {}),
  };
}

/**
 * Evaluates one decision and publishes its result into the context.
 *
 * Diagnostics raised inside an invoked function arrive through `sink` rather
 * than through the return value, because a `FeelFunction` returns a value and
 * nothing else. Evaluation is sequential, so whatever is in the sink was
 * produced by this decision; draining it here attributes it correctly.
 */
function evaluateOne(
  decision: CompiledDecision,
  context: Record<string, FeelValue>,
  sink: Diagnostic[],
  tracer: Tracer,
): DecisionResult {
  sink.length = 0;

  tracer.record('DECISIONS', {
    type: 'decision-started',
    decision: decision.name,
    decisionId: decision.id,
  });

  const outcome = evaluateExpression(decision.expression, context, tracer, decision);
  const value = coerceToDeclaredType(outcome.value, decision.typeRef, decision.typeShape);

  context[decision.name] = value;

  tracer.record('DECISIONS', {
    type: outcome.failed ? 'decision-failed' : 'decision-completed',
    decision: decision.name,
    decisionId: decision.id,
    ...(outcome.failed && outcome.messages[0] !== undefined
      ? { detail: outcome.messages[0] }
      : {}),
    ...tracer.value(decision.name, value),
  });

  for (const warning of outcome.warnings) {
    tracer.record('RULES', {
      type: 'diagnostic',
      decision: decision.name,
      detail: `${warning.code}: ${warning.message}`,
    });
  }

  return {
    name: decision.name,
    value,
    failed: outcome.failed,
    messages: outcome.messages,
    warnings: [...outcome.warnings, ...sink],
  };
}

/**
 * Evaluates a decision service.
 *
 * This is **not** the same operation as evaluating its output decision
 * directly, and is deliberately not implemented in terms of it:
 *
 * - only the service's declared `inputData` and `inputDecision` are visible;
 *   anything else the caller supplies is ignored and reported;
 * - an `inputDecision` is a parameter. Its value comes from the caller, and
 *   the decision behind it is never evaluated — which is the whole point of
 *   the encapsulation, and what a naive implementation gets wrong;
 * - only decisions reachable from the outputs, stopping at those parameters,
 *   are evaluated.
 */
export function evaluateDecisionService(
  compiled: CompiledDmnModel,
  serviceName: string,
  inputs: FeelContext,
  options: EvaluateOptions = {},
): EvaluationResult {
  const tracer = options.trace === undefined ? NO_TRACE : new Tracer(options.trace);
  tracer.record('SUMMARY', { type: 'evaluation-started', detail: serviceName });
  const service = compiled.services.get(serviceName);

  if (service === undefined) {
    return {
      decisions: new Map(),
      failed: true,
      warnings: [`No decision service named ${JSON.stringify(serviceName)}.`],
    };
  }

  const warnings: string[] = [];
  const context: Record<string, FeelValue> = Object.create(null) as Record<string, FeelValue>;

  const declared = new Set([...service.inputDataNames, ...service.inputDecisionNames]);

  for (const name of declared) {
    // A declared input the caller omitted is null, as DMN treats any absent
    // input; an input decision is never evaluated to fill the gap.
    context[name] = Object.prototype.hasOwnProperty.call(inputs, name)
      ? (inputs[name] ?? null)
      : null;
  }

  for (const name of Object.keys(inputs)) {
    if (!declared.has(name)) {
      warnings.push(
        `Input ${JSON.stringify(name)} is not declared by decision service ` +
          `${JSON.stringify(service.name)} and was ignored.`,
      );
    }
  }

  const reachable = reachableFrom(compiled, service);
  const results = new Map<string, DecisionResult>();
  const sink: Diagnostic[] = [];

  bindKnowledgeModels(compiled, context, sink);

  for (const id of compiled.order) {
    if (!reachable.has(id)) {
      continue;
    }

    const decision = compiled.decisions.get(id);
    if (decision === undefined) {
      continue;
    }

    results.set(decision.name, evaluateOne(decision, context, sink, tracer));
  }

  const outputs = service.outputDecisionIds
    .map((id) => compiled.decisions.get(id))
    .filter((decision): decision is NonNullable<typeof decision> => decision !== undefined);

  let value: FeelValue = null;

  if (outputs.length === 1) {
    value = results.get((outputs[0] as { name: string }).name)?.value ?? null;
  } else if (outputs.length > 1) {
    const composed: Record<string, FeelValue> = Object.create(null) as Record<string, FeelValue>;
    for (const output of outputs) {
      composed[output.name] = results.get(output.name)?.value ?? null;
    }
    value = composed;
  }

  const serviceFailed = [...results.values()].some((result) => result.failed);
  tracer.record('SUMMARY', {
    type: 'evaluation-completed',
    detail: serviceFailed ? 'FAILED' : 'SUCCEEDED',
  });

  return {
    decisions: results,
    failed: serviceFailed,
    value,
    warnings,
    ...(tracer.enabled ? { trace: tracer.finish() } : {}),
  };
}

/** Output decisions and everything they need, stopping at the service's parameters. */
function reachableFrom(
  compiled: CompiledDmnModel,
  service: CompiledDecisionService,
): Set<string> {
  const reachable = new Set<string>();
  const parameters = new Set(service.inputDecisionIds);
  const pending = [...service.outputDecisionIds];

  while (pending.length > 0) {
    const id = pending.pop() as string;

    if (reachable.has(id) || parameters.has(id)) {
      continue;
    }

    const decision = compiled.decisions.get(id);
    if (decision === undefined) {
      continue;
    }

    reachable.add(id);
    pending.push(...decision.requiredDecisionIds);
  }

  return reachable;
}

export function evaluateExpression(
  expression: CompiledExpression,
  context: FeelContext,
  tracer: Tracer = NO_TRACE,
  decision?: { name: string; id: string },
): Outcome {
  switch (expression.kind) {
    case 'literal': {
      const evaluation = expression.expression.evaluate(context);
      return {
        value: evaluation.value,
        failed: false,
        messages: [],
        warnings: [...evaluation.warnings],
      };
    }

    case 'table':
      return evaluateTable(expression, context, tracer, decision);

    case 'list': {
      const outcome: Outcome = ok([]);
      const items: FeelValue[] = [];

      for (const item of expression.items) {
        const evaluated = evaluateExpression(item, context);
        items.push(evaluated.value);
        merge(outcome, evaluated);
      }

      outcome.value = items;
      return outcome;
    }

    case 'context': {
      const outcome = ok(null);
      const entries: Record<string, FeelValue> = Object.create(null) as Record<
        string,
        FeelValue
      >;
      let scoped: FeelContext = context;
      let lastUnnamed: FeelValue | undefined;

      for (const entry of expression.entries) {
        const evaluated = evaluateExpression(entry.value, scoped);
        merge(outcome, evaluated);

        if (entry.name === undefined) {
          // An unnamed final entry is the context's result value.
          lastUnnamed = evaluated.value;
          continue;
        }

        entries[entry.name] = evaluated.value;
        scoped = { ...scoped, [entry.name]: evaluated.value };
      }

      outcome.value = lastUnnamed === undefined ? entries : lastUnnamed;
      return outcome;
    }

    case 'invocation': {
      const outcome = ok(null);

      if (expression.callee === undefined) {
        return failure('invocation has no callee');
      }

      const callee = evaluateExpression(expression.callee, context);
      merge(outcome, callee);

      if (!isFeelFunction(callee.value)) {
        return failure('invocation callee is not a function');
      }

      const fn = callee.value;

      // Boxed invocation binds by parameter name, never by position.
      const supplied = new Map<string, FeelValue>();
      for (const binding of expression.bindings) {
        const value = evaluateExpression(binding.value, context);
        merge(outcome, value);
        supplied.set(binding.parameter, value.value);
      }

      const unknown = [...supplied.keys()].filter(
        (name) => !fn.parameters.includes(name),
      );

      if (unknown.length > 0) {
        // TCK 0082 `invoke_007`: a binding naming something that is not a
        // formal parameter means the function is never invoked. Calling it
        // anyway and ignoring the stray binding would hide a modelling error.
        return failure(
          `Invocation binds ${unknown.map((name) => JSON.stringify(name)).join(', ')}, which ` +
            `${JSON.stringify(fn.name ?? 'the function')} does not declare.`,
        );
      }

      const args = fn.parameters.map((name) => supplied.get(name) ?? null);
      outcome.value = fn.invoke(args);
      return outcome;
    }

    case 'function':
      return ok(functionValue(expression, context, []));

    case 'unsupported':
      return failure(expression.reason);
  }
}

/** Turns a compiled function definition into an invocable FEEL value. */
function functionValue(
  compiled: CompiledFunction,
  closure: FeelContext,
  sink: Diagnostic[],
): FeelFunction {
  return {
    kind: 'function',
    ...(compiled.name === undefined ? {} : { name: compiled.name }),
    parameters: compiled.parameters,
    invoke(args) {
      // Lexical scope: the body sees where the function was defined, with its
      // parameters bound over that.
      const scoped: Record<string, FeelValue> = Object.create(null) as Record<
        string,
        FeelValue
      >;
      for (const [name, value] of Object.entries(closure)) {
        scoped[name] = value;
      }
      compiled.parameters.forEach((name, index) => {
        scoped[name] = args[index] ?? null;
      });

      const outcome = evaluateExpression(compiled.body, scoped);
      sink.push(...outcome.warnings);

      if (outcome.failed) {
        // Surfaced as a diagnostic rather than a silent null, so that a caller
        // judging results can tell "did not evaluate" from "evaluated to null".
        sink.push({
          code: 'FEEL_UNSUPPORTED_CONSTRUCT',
          severity: 'WARNING',
          message: outcome.messages[0] ?? 'function body could not be evaluated',
        });
      }

      return outcome.value;
    },
  };
}

/**
 * Binds every business knowledge model into the evaluation context.
 *
 * A BKM is a function value, so an invocation — boxed or written in FEEL — is
 * an ordinary name lookup followed by a call. Binding them all at once, rather
 * than per decision's `knowledgeRequirement`, matches how the compiled scope is
 * built and lets one BKM invoke another.
 *
 * The closure is the live context, so a BKM invoked partway through evaluation
 * sees the decisions computed so far.
 */
function bindKnowledgeModels(
  compiled: CompiledDmnModel,
  context: Record<string, FeelValue>,
  sink: Diagnostic[],
): void {
  for (const [name, bkm] of compiled.bkms) {
    context[name] = functionValue(
      { kind: 'function', name, parameters: bkm.parameters, body: bkm.body },
      context,
      sink,
    );
  }
}

/**
 * Applies DMN's singleton-list coercion to a result.
 *
 * TCK `0082-feel-coercion` pins the rule in both directions, and — importantly
 * — pins that it is conditional:
 *
 * - a one-element list assigned to a scalar type yields the element, but only
 *   if the element conforms; `literal_006` assigns `["foo"]` to `number` and
 *   expects **null**, not `"foo"`;
 * - a scalar assigned to a collection type yields a one-element list, but only
 *   if it conforms; `decision_006_a` assigns `"foo"` to a list-of-number and
 *   also expects **null**.
 *
 * Drools 10.2.0 returns the uncoerced value in both of those cases, so this
 * follows the TCK against the reference engine — one of the few places the two
 * disagree. Recorded in docs/unverified-semantics.md.
 *
 * Conformance is only ever asserted, never guessed: where the declared type is
 * structured, temporal, or unresolvable, the value is accepted, because
 * rejecting it would mean claiming knowledge the type table does not have.
 */
export function coerceToDeclaredType(
  value: FeelValue,
  typeRef: string | undefined,
  shape: TypeShape | undefined,
): FeelValue {
  if (typeRef === undefined || shape === undefined || value === null) {
    return value;
  }

  if (shape.isCollection) {
    if (isFeelList(value)) {
      // A list already has the right shape, but its elements still have to
      // belong to the declared element type: TCK `invoke_004` assigns a
      // list-of-string to a list-of-number and expects null.
      return value.every((item) => conformsTo(item, shape.scalar)) ? value : null;
    }
    return conformsTo(value, shape.scalar) ? [value] : null;
  }

  if (!isFeelList(value) || value.length !== 1) {
    return value;
  }

  const only = value[0] ?? null;
  return conformsTo(only, shape.scalar) ? only : null;
}

function conformsTo(value: FeelValue, scalar: ScalarType | undefined): boolean {
  if (scalar === undefined || value === null) {
    return true;
  }
  return feelTypeOf(value) === scalar;
}

function merge(target: Outcome, source: Outcome): void {
  target.warnings.push(...source.warnings);
  target.messages.push(...source.messages);
  target.failed ||= source.failed;
}

// --- decision tables ------------------------------------------------------

function evaluateTable(
  compiled: CompiledTable,
  context: FeelContext,
  tracer: Tracer = NO_TRACE,
  decision?: { name: string; id: string },
): Outcome {
  const outcome = ok(null);
  const { table } = compiled;

  const inputValues = compiled.inputs.map((input) => {
    const evaluation = input.evaluate(context);
    outcome.warnings.push(...evaluation.warnings);
    return evaluation.value;
  });

  const matches: CompiledRule[] = [];

  for (const rule of compiled.rules) {
    let matched = true;

    for (const [position, entry] of rule.inputEntries.entries()) {
      const evaluation = entry.test(inputValues[position] ?? null, context);
      outcome.warnings.push(...evaluation.warnings);

      if (evaluation.value !== true) {
        matched = false;
        break;
      }
    }

    if (matched) {
      matches.push(rule);

      // FIRST needs only the first match; UNIQUE needs only to know there is
      // a second one. Both stop early, which is safe because output entries
      // are evaluated separately.
      if (table.hitPolicy === 'FIRST') break;
      if (table.hitPolicy === 'UNIQUE' && matches.length > 1) break;
    }
  }

  tracer.record('RULES', {
    type: 'table-evaluated',
    ...(decision === undefined ? {} : { decision: decision.name, decisionId: decision.id }),
    hitPolicy: table.hitPolicy,
    ruleIds: matches.map((rule) => rule.id ?? `#${String(rule.index + 1)}`),
    detail: `${String(matches.length)} of ${String(compiled.rules.length)} rules matched`,
  });

  for (const rule of matches) {
    tracer.record('RULES', {
      type: 'rule-matched',
      ...(decision === undefined ? {} : { decision: decision.name, decisionId: decision.id }),
      ruleIds: [rule.id ?? `#${String(rule.index + 1)}`],
      detail: `rule ${String(rule.index + 1)}`,
    });
  }

  if (matches.length === 0) {
    outcome.value = defaultOutput(compiled, context, outcome);
    tracer.record('RULES', {
      type: 'hit-policy-applied',
      ...(decision === undefined ? {} : { decision: decision.name, decisionId: decision.id }),
      hitPolicy: table.hitPolicy,
      detail: 'no rule matched; default output applied',
    });
    return outcome;
  }

  tracer.record('RULES', {
    type: 'hit-policy-applied',
    ...(decision === undefined ? {} : { decision: decision.name, decisionId: decision.id }),
    hitPolicy: table.hitPolicy,
    detail: `${table.hitPolicy} applied to ${String(matches.length)} match(es)`,
  });

  switch (table.hitPolicy) {
    case 'UNIQUE':
      if (matches.length > 1) {
        return failure(
          `UNIQUE hit policy matched ${String(matches.length)} rules in decision table ${
            table.id ?? '(anonymous)'
          }.`,
        );
      }
      outcome.value = outputOf(compiled, matches[0] as CompiledRule, context, outcome);
      return outcome;

    case 'FIRST':
      outcome.value = outputOf(compiled, matches[0] as CompiledRule, context, outcome);
      return outcome;

    case 'ANY': {
      const values = matches.map((rule) => outputOf(compiled, rule, context, outcome));
      const first = values[0] as FeelValue;

      // Undecidable equality is not agreement: ANY requires the outputs to be
      // demonstrably the same, so anything short of `true` is a conflict.
      if (!values.every((value) => feelEquals(value, first) === true)) {
        return failure(
          `ANY hit policy matched rules with differing outputs in decision table ${
            table.id ?? '(anonymous)'
          }.`,
        );
      }

      outcome.value = first;
      return outcome;
    }

    case 'PRIORITY': {
      const ordered = byOutputPriority(compiled, matches, context, outcome);
      outcome.value = ordered[0] ?? null;
      return outcome;
    }

    case 'OUTPUT ORDER':
      outcome.value = byOutputPriority(compiled, matches, context, outcome);
      return outcome;

    case 'RULE ORDER':
      outcome.value = matches.map((rule) => outputOf(compiled, rule, context, outcome));
      return outcome;

    case 'COLLECT': {
      const values = matches.map((rule) => outputOf(compiled, rule, context, outcome));
      outcome.value = aggregate(compiled, values, outcome);
      return outcome;
    }
  }
}

/**
 * The result of one rule.
 *
 * A single output clause produces the value directly; two or more produce a
 * context keyed by output name.
 */
function outputOf(
  compiled: CompiledTable,
  rule: CompiledRule,
  context: FeelContext,
  outcome: Outcome,
): FeelValue {
  const values = rule.outputEntries.map((entry) => {
    const evaluation = entry.evaluate(context);
    outcome.warnings.push(...evaluation.warnings);
    return evaluation.value;
  });

  if (compiled.outputs.length <= 1) {
    return values[0] ?? null;
  }

  const result: Record<string, FeelValue> = Object.create(null) as Record<string, FeelValue>;

  for (const [position, output] of compiled.outputs.entries()) {
    result[output.name ?? `output${String(position + 1)}`] = values[position] ?? null;
  }

  return result;
}

function defaultOutput(
  compiled: CompiledTable,
  context: FeelContext,
  outcome: Outcome,
): FeelValue {
  const multiHit =
    compiled.table.hitPolicy === 'COLLECT' ||
    compiled.table.hitPolicy === 'RULE ORDER' ||
    compiled.table.hitPolicy === 'OUTPUT ORDER';

  const defaults = compiled.outputs.map((output) => {
    if (output.defaultOutputEntry === undefined) {
      return null;
    }
    const evaluation = output.defaultOutputEntry.evaluate(context);
    outcome.warnings.push(...evaluation.warnings);
    return evaluation.value;
  });

  const hasDefault = compiled.outputs.some((output) => output.defaultOutputEntry !== undefined);

  if (!hasDefault) {
    // COLLECT with no matches collects nothing — but an aggregator still has
    // to aggregate it. Returning the empty list would hand the caller a list
    // where the table promised a number, and a scoring table that matches no
    // rule would produce `[]` rather than a zero score.
    if (compiled.table.hitPolicy === 'COLLECT' && compiled.table.aggregation !== undefined) {
      return aggregate(compiled, [], outcome);
    }

    // Any other multi-hit policy collects nothing; a single-hit policy is null.
    return multiHit ? [] : null;
  }

  if (compiled.outputs.length <= 1) {
    return defaults[0] ?? null;
  }

  const result: Record<string, FeelValue> = Object.create(null) as Record<string, FeelValue>;
  for (const [position, output] of compiled.outputs.entries()) {
    result[output.name ?? `output${String(position + 1)}`] = defaults[position] ?? null;
  }
  return result;
}

/**
 * Orders matched rules by the position of their first output value inside the
 * output clause's `outputValues` list.
 */
function byOutputPriority(
  compiled: CompiledTable,
  matches: readonly CompiledRule[],
  context: FeelContext,
  outcome: Outcome,
): FeelValue[] {
  const priorities = (compiled.outputs[0]?.outputOrder ?? []).map((expression) => {
    const evaluation = expression.evaluate(context);
    outcome.warnings.push(...evaluation.warnings);
    return evaluation.value;
  });

  const scored = matches.map((rule) => {
    const value = outputOf(compiled, rule, context, outcome);
    const comparable =
      compiled.outputs.length <= 1
        ? value
        : ((value as Record<string, FeelValue>)[compiled.outputs[0]?.name ?? ''] ?? null);

    const rank = priorities.findIndex((priority) => feelEquals(priority, comparable) === true);

    return { value, rank: rank < 0 ? Number.MAX_SAFE_INTEGER : rank, order: rule.index };
  });

  scored.sort((left, right) => left.rank - right.rank || left.order - right.order);

  return scored.map((entry) => entry.value);
}

function aggregate(
  compiled: CompiledTable,
  values: readonly FeelValue[],
  outcome: Outcome,
): FeelValue {
  const { aggregation } = compiled.table;

  if (aggregation === undefined) {
    return [...values];
  }

  if (aggregation === 'COUNT') {
    return toFeelNumber(String(values.length));
  }

  const numbers = values.filter(isFeelNumber);

  if (numbers.length !== values.length) {
    outcome.messages.push(
      `COLLECT ${aggregation} requires numeric outputs; ${String(
        values.length - numbers.length,
      )} were not numbers.`,
    );
    outcome.failed = true;
    return null;
  }

  if (numbers.length === 0) {
    return aggregation === 'SUM' ? toFeelNumber('0') : null;
  }

  if (aggregation === 'SUM') {
    let total = toFeelNumber('0');
    for (const number of numbers) {
      total = total === null ? null : arithmetic('+', total, number);
    }
    return total;
  }

  let best = numbers[0] as FeelValue;
  for (const number of numbers) {
    const ordering = feelCompare(number, best);
    if (ordering === null) continue;
    if (aggregation === 'MIN' ? ordering < 0 : ordering > 0) {
      best = number;
    }
  }
  return best;
}
