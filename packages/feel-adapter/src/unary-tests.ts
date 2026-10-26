/**
 * FEEL unary tests — the input entries of a decision table, and the right-hand
 * side of the `in` operator.
 *
 * Original work. Implements the unary-test forms decision tables need: the
 * irrelevant entry `-`, comma-separated alternatives, comparison operators,
 * intervals, negation, and bare expressions tested for equality.
 *
 * Evaluation of the sub-expressions arrives as a callback rather than an
 * import, so this module does not depend on the evaluator that depends on it.
 */

import type { SyntaxNode } from '@lezer/common';

import { FEEL_DIAGNOSTIC_CODES, spanFor, type Diagnostic } from './diagnostics.js';
import { significantChildren } from './parse.js';
import {
  feelCompare,
  feelEquals,
  feelNotEquals,
  isFeelList,
  isFeelRange,
  type FeelContext,
  type FeelRange,
  type FeelValue,
} from './values.js';

export interface UnaryTestOutcome {
  readonly value: boolean | null;
  readonly warnings: readonly Diagnostic[];
}

/** How the evaluator evaluates a sub-expression. Supplied by the caller. */
export type EvaluateFn = (
  source: string,
  node: SyntaxNode,
  context: FeelContext,
) => { value: FeelValue; warnings: readonly Diagnostic[] };

/**
 * How a bare list on the right-hand side is read.
 *
 * A decision-table entry compares for equality; `x in [1, 2, 3]` asks for
 * membership. Same syntax, different question, so the caller says which.
 */
export type ListSemantics = 'equality' | 'membership';

/**
 * The name under which the tested value is bound.
 *
 * DMN 1.3 allows an input entry to be a full boolean expression referring to
 * the input value as `?`.
 */
export const INPUT_VALUE_NAME = '?';

export function evaluateUnaryTests(
  evaluate: EvaluateFn,
  source: string,
  root: SyntaxNode,
  input: FeelValue,
  context: FeelContext,
): UnaryTestOutcome {
  const children = significantChildren(root);

  // `-` and an empty entry both always match.
  if (children.length === 0 || children.some((child) => child.name === 'Wildcard')) {
    return { value: true, warnings: [] };
  }

  // `not(...)` negates the whole list of alternatives. The marker is kept by
  // the parser deliberately: dropping it silently turns a negated test into a
  // positive one, which inverts every match.
  const negated = children[0]?.name === 'not';
  const tests = negated ? children.slice(1) : children;

  const outcome = testAlternatives(
    evaluate,
    source,
    tests.flatMap((child) =>
      child.name === 'PositiveUnaryTests' ? significantChildren(child) : [child],
    ),
    input,
    context,
    'equality',
  );

  if (!negated || outcome.value === null) {
    return outcome;
  }

  return { value: !outcome.value, warnings: outcome.warnings };
}

/**
 * Tests a value against a list of alternatives, any of which may match.
 *
 * A test that cannot be decided yields null rather than false — the difference
 * between "no match" and "could not tell", which a decision table must keep.
 */
export function testAlternatives(
  evaluate: EvaluateFn,
  source: string,
  alternatives: readonly SyntaxNode[],
  input: FeelValue,
  context: FeelContext,
  lists: ListSemantics,
): UnaryTestOutcome {
  const warnings: Diagnostic[] = [];
  const scoped: FeelContext = { ...context, [INPUT_VALUE_NAME]: input };
  let sawNull = false;

  for (const alternative of alternatives) {
    const outcome = evaluateOne(evaluate, source, alternative, input, scoped, lists);
    warnings.push(...outcome.warnings);

    if (outcome.value === true) {
      return { value: true, warnings };
    }

    if (outcome.value === null) {
      sawNull = true;
    }
  }

  return { value: sawNull ? null : false, warnings };
}

function evaluateOne(
  evaluate: EvaluateFn,
  source: string,
  node: SyntaxNode,
  input: FeelValue,
  scoped: FeelContext,
  lists: ListSemantics,
): UnaryTestOutcome {
  if (node.name === 'PositiveUnaryTest' || node.name === 'SimplePositiveUnaryTest') {
    const children = significantChildren(node);

    // Comparison form: an operator followed by its operand, with the tested
    // value implied on the left.
    if (children[0]?.name === 'CompareOp' && children[1] !== undefined) {
      return compare(evaluate, source, children[0], children[1], input, scoped);
    }

    const only = children[0];
    if (children.length === 1 && only !== undefined) {
      return evaluateOne(evaluate, source, only, input, scoped, lists);
    }

    return unsupported(source, node, 'unary test form');
  }

  if (node.name === 'Interval') {
    const { value, warnings } = evaluate(source, node, scoped);
    return { value: isFeelRange(value) ? contains(value, input) : null, warnings };
  }

  const { value, warnings } = evaluate(source, node, scoped);

  // A boolean expression mentioning `?` tests the value directly.
  if (typeof value === 'boolean' && referencesInputValue(source, node)) {
    return { value, warnings };
  }

  if (lists === 'membership' && isFeelList(value)) {
    return { value: memberOf(input, value), warnings };
  }

  if (isFeelRange(value)) {
    return { value: contains(value, input), warnings };
  }

  return { value: feelEquals(input, value), warnings };
}

/** Membership for `x in [...]`: any element equal to the tested value. */
function memberOf(input: FeelValue, items: readonly FeelValue[]): boolean | null {
  let sawNull = false;

  for (const item of items) {
    const equal = feelEquals(input, item);
    if (equal === true) {
      return true;
    }
    if (equal === null) {
      sawNull = true;
    }
  }

  return sawNull ? null : false;
}

function compare(
  evaluate: EvaluateFn,
  source: string,
  operatorNode: SyntaxNode,
  operandNode: SyntaxNode,
  input: FeelValue,
  scoped: FeelContext,
): UnaryTestOutcome {
  const { value: operand, warnings } = evaluate(source, operandNode, scoped);
  const operator = source.slice(operatorNode.from, operatorNode.to).trim();

  if (operator === '=') return { value: feelEquals(input, operand), warnings };
  if (operator === '!=') return { value: feelNotEquals(input, operand), warnings };

  const ordering = feelCompare(input, operand);
  if (ordering === null) {
    return { value: null, warnings };
  }

  switch (operator) {
    case '<':
      return { value: ordering < 0, warnings };
    case '<=':
      return { value: ordering <= 0, warnings };
    case '>':
      return { value: ordering > 0, warnings };
    case '>=':
      return { value: ordering >= 0, warnings };
    default:
      return unsupported(source, operatorNode, `operator ${JSON.stringify(operator)}`);
  }
}

/** Range containment, honouring each endpoint's inclusivity. */
function contains(range: FeelRange, input: FeelValue): boolean | null {
  const lower = feelCompare(input, range.start);
  const upper = feelCompare(input, range.end);

  if (lower === null || upper === null) {
    return null;
  }

  const aboveStart = range.startIncluded ? lower >= 0 : lower > 0;
  const belowEnd = range.endIncluded ? upper <= 0 : upper < 0;

  return aboveStart && belowEnd;
}

function referencesInputValue(source: string, node: SyntaxNode): boolean {
  return source.slice(node.from, node.to).includes(INPUT_VALUE_NAME);
}

function unsupported(source: string, node: SyntaxNode, construct: string): UnaryTestOutcome {
  return {
    value: null,
    warnings: [
      {
        code: FEEL_DIAGNOSTIC_CODES.FEEL_UNSUPPORTED_CONSTRUCT,
        severity: 'WARNING',
        message: `Unsupported FEEL construct: ${construct}.`,
        source: spanFor(source, node.from, node.to),
      },
    ],
  };
}
