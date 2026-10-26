/**
 * FEEL evaluation.
 *
 * Original work, written against the OMG DMN 1.5 specification and verified
 * against the reference engines. It walks the
 * `lezer-feel` syntax tree; no evaluation code is adapted from `feelin`.
 *
 * Scope of this release: literals, arithmetic, comparison, boolean logic,
 * conditionals, lists, ranges, and name and path resolution. Constructs outside
 * that set produce an explicit `FEEL_UNSUPPORTED_CONSTRUCT` diagnostic and a
 * null value. Reporting a construct as unsupported is always preferred over
 * evaluating it approximately.
 */

import type { SyntaxNode } from '@lezer/common';

import {
  FEEL_DIAGNOSTIC_CODES,
  spanFor,
  type Diagnostic,
  type FeelDiagnosticCode,
} from './diagnostics.js';
import { arithmetic, isFeelNumber, negate, toFeelNumber, type FeelNumber } from './number.js';
import { BUILTINS } from './builtins.js';
import { parseAtLiteral } from './temporal.js';
import {
  UNKNOWN_CONSTRUCTOR,
  constructTemporal,
  temporalArithmetic,
  temporalProperty,
} from './temporal-ops.js';
import { significantChildren } from './parse.js';
import { testAlternatives } from './unary-tests.js';
import {
  feelCompare,
  feelEquals,
  feelNotEquals,
  feelTypeOf,
  isFeelContext,
  isFeelFunction,
  type FeelContext,
  type FeelFunction,
  type FeelRange,
  type FeelValue,
} from './values.js';

export interface EvaluationOutcome {
  readonly value: FeelValue;
  readonly warnings: readonly Diagnostic[];
}

/** Property names that must never be resolved through a context lookup. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Bound on nested invocation.
 *
 * A recursive business knowledge model would otherwise exhaust the JavaScript
 * stack, which surfaces as a host crash rather than a diagnostic. This bound
 * is the cooperative form of a resource limit.
 *
 * Module-level because a function's closure re-enters the evaluator, so the
 * count has to outlive any single Evaluator. Evaluation is synchronous and
 * non-reentrant across requests, so there is nothing to interleave with.
 */
/** FEEL type names whose membership `instance of` can actually decide. */
const DECIDABLE_TYPES = new Set(['number', 'string', 'boolean', 'list', 'context', 'function', 'range']);

const MAX_CALL_DEPTH = 64;
let callDepth = 0;

export class Evaluator {
  private readonly warnings: Diagnostic[] = [];

  constructor(
    private readonly source: string,
    private readonly context: FeelContext,
  ) {}

  static run(source: string, root: SyntaxNode, context: FeelContext): EvaluationOutcome {
    const evaluator = new Evaluator(source, context);
    const value = evaluator.evaluate(root);
    return { value, warnings: evaluator.warnings };
  }

  evaluate(node: SyntaxNode): FeelValue {
    switch (node.name) {
      case 'Expression':
      case 'Expressions':
      case 'ParenthesizedExpression':
      // A function body is a wrapper the grammar adds; the expression inside
      // is what evaluates.
      case 'FunctionBody':
        return this.evaluateOnlyChild(node);

      case 'NumericLiteral':
        return this.numericLiteral(node);

      case 'StringLiteral':
        return unescapeString(this.text(node));

      case 'BooleanLiteral':
        return this.text(node).trim() === 'true';

      case 'null':
        return null;

      case 'ArithmeticExpression':
        return this.arithmeticExpression(node);

      case 'Comparison':
        return this.comparison(node);

      case 'Conjunction':
        return this.conjunction(node);

      case 'Disjunction':
        return this.disjunction(node);

      case 'IfExpression':
        return this.ifExpression(node);

      case 'List':
        return significantChildren(node).map((child) => this.evaluate(child));

      case 'Context':
        return this.contextLiteral(node);

      case 'InstanceOfExpression':
        return this.instanceOf(node);

      case 'DateTimeLiteral':
        return this.dateTimeLiteral(node);

      case 'Interval':
        return this.interval(node);

      case 'VariableName':
      // `years and months duration` and friends are lexed as one name; they
      // resolve exactly like any other, which is what makes the literal form
      // and the call form share an implementation.
      case 'SpecialFunctionName':
        return this.variable(node);

      case 'PathExpression':
        return this.path(node);

      case 'FunctionInvocation':
        return this.invocation(node);

      case 'FunctionDefinition':
        return this.functionDefinition(node);

      default:
        return this.unsupported(node, node.name);
    }
  }

  // --- literals -----------------------------------------------------------

  private numericLiteral(node: SyntaxNode): FeelValue {
    // Unary minus is folded into the literal by the grammar, and may be
    // separated from the digits by whitespace.
    const literal = this.text(node).replace(/\s+/gu, '');
    const value = toFeelNumber(literal);

    if (value === null) {
      return this.unsupported(node, `numeric literal ${JSON.stringify(literal)}`);
    }

    return value;
  }

  /**
   * `date("…")`, `time(…)`, `date and time(…)`, `duration(…)` and the `@"…"`
   * shorthand.
   *
   * The constructors also exist as built-in functions, and route to the same
   * implementations — the literal form is just what the grammar recognises
   * when the constructor name is written directly.
   */
  private dateTimeLiteral(node: SyntaxNode): FeelValue {
    const children = significantChildren(node);
    const first = children[0];

    if (first?.name === 'AtLiteral') {
      const literal = unescapeString(this.text(first).trim().slice(1));
      const value = parseAtLiteral(literal);
      return value ?? this.invalidTemporal(first, literal);
    }

    if (first?.name !== 'DateTimeConstructor') {
      return this.unsupported(node, 'temporal literal');
    }

    const constructor = this.text(first).trim().replace(/\s+/gu, ' ');
    const args = children[1];
    const values =
      args === undefined ? [] : significantChildren(args).map((child) => this.evaluate(child));

    const built = constructTemporal(constructor, values);

    if (built === UNKNOWN_CONSTRUCTOR) {
      return this.unsupported(first, `temporal constructor ${JSON.stringify(constructor)}`);
    }

    return built;
  }

  private invalidTemporal(node: SyntaxNode, literal: string): null {
    // Malformed temporal input is a FEEL null, not an error — but it is worth
    // a diagnostic, because a typo in a date is otherwise silent.
    this.warn(
      FEEL_DIAGNOSTIC_CODES.FEEL_INVALID_TEMPORAL,
      `${JSON.stringify(literal)} is not a valid temporal value.`,
      node,
    );
    return null;
  }

  // --- operators ----------------------------------------------------------

  private arithmeticExpression(node: SyntaxNode): FeelValue {
    const children = significantChildren(node);

    // Unary form: ArithOp followed by its operand.
    if (children.length === 2 && children[0]?.name === 'ArithOp') {
      const operand = this.evaluate(children[1] as SyntaxNode);
      if (!isFeelNumber(operand)) {
        return null;
      }
      return this.text(children[0] as SyntaxNode).trim() === '-' ? negate(operand) : operand;
    }

    const [leftNode, operatorNode, rightNode] = children;
    if (leftNode === undefined || operatorNode === undefined || rightNode === undefined) {
      return this.unsupported(node, 'arithmetic expression');
    }

    const left = this.evaluate(leftNode);
    const right = this.evaluate(rightNode);
    const operator = this.text(operatorNode).trim();

    // String concatenation shares the `+` operator with numeric addition.
    if (operator === '+' && typeof left === 'string' && typeof right === 'string') {
      return left + right;
    }

    // Temporal arithmetic answers for any combination involving a date, time
    // or duration; `undefined` means neither operand was temporal.
    const temporal = temporalArithmetic(operator, left, right);
    if (temporal !== undefined) {
      return temporal;
    }

    if (!isFeelNumber(left) || !isFeelNumber(right)) {
      // FEEL arithmetic over a non-number is null, not an error.
      return null;
    }

    if (!isArithmeticOperator(operator)) {
      return this.unsupported(operatorNode, `operator ${JSON.stringify(operator)}`);
    }

    return arithmetic(operator, left, right);
  }

  private comparison(node: SyntaxNode): FeelValue {
    const children = significantChildren(node);
    const [leftNode, operatorNode, rightNode] = children;

    if (leftNode === undefined || operatorNode === undefined || rightNode === undefined) {
      return this.unsupported(node, 'comparison form');
    }

    // `x between a and b` — the grammar keeps the `between` marker but drops
    // the `and`, so the bounds arrive as the third and fourth children.
    if (operatorNode.name === 'between') {
      return this.between(node, leftNode, rightNode, children[3]);
    }

    // `x in <tests>` — the right side is unary-test syntax, not an ordinary
    // expression, so it is evaluated by the unary-test rules.
    if (operatorNode.name === 'in') {
      const outcome = testAlternatives(
        Evaluator.run,
        this.source,
        rightNode.name === 'PositiveUnaryTests' ? significantChildren(rightNode) : [rightNode],
        this.evaluate(leftNode),
        this.context,
        'membership',
      );
      this.warnings.push(...outcome.warnings);
      return outcome.value;
    }

    if (operatorNode.name !== 'CompareOp') {
      return this.unsupported(node, 'comparison form');
    }

    const left = this.evaluate(leftNode);
    const right = this.evaluate(rightNode);
    const operator = this.text(operatorNode).trim();

    if (operator === '=') return feelEquals(left, right);
    if (operator === '!=') return feelNotEquals(left, right);

    const ordering = feelCompare(left, right);
    if (ordering === null) {
      // Incomparable operands yield null rather than false, so that a failed
      // comparison is distinguishable from a genuine "not greater than".
      return null;
    }

    switch (operator) {
      case '<':
        return ordering < 0;
      case '<=':
        return ordering <= 0;
      case '>':
        return ordering > 0;
      case '>=':
        return ordering >= 0;
      default:
        return this.unsupported(operatorNode, `operator ${JSON.stringify(operator)}`);
    }
  }

  /**
   * FEEL `and` is three-valued: false dominates, and a non-boolean operand
   * yields null rather than an error.
   */
  private conjunction(node: SyntaxNode): FeelValue {
    const operands = significantChildren(node).map((child) => this.evaluate(child));

    if (operands.some((value) => value === false)) {
      return false;
    }

    return operands.every((value) => value === true) ? true : null;
  }

  /** FEEL `or` is three-valued: true dominates. */
  private disjunction(node: SyntaxNode): FeelValue {
    const operands = significantChildren(node).map((child) => this.evaluate(child));

    if (operands.some((value) => value === true)) {
      return true;
    }

    return operands.every((value) => value === false) ? false : null;
  }

  private ifExpression(node: SyntaxNode): FeelValue {
    const [conditionNode, thenNode, elseNode] = significantChildren(node);

    if (conditionNode === undefined || thenNode === undefined) {
      return this.unsupported(node, 'conditional expression');
    }

    const condition = this.evaluate(conditionNode);

    // A non-boolean condition selects the else branch, matching DMN 1.5.
    if (condition === true) {
      return this.evaluate(thenNode);
    }

    return elseNode === undefined ? null : this.evaluate(elseNode);
  }

  private interval(node: SyntaxNode): FeelValue {
    const text = this.text(node);
    const [startNode, endNode] = significantChildren(node);

    if (startNode === undefined || endNode === undefined) {
      return this.unsupported(node, 'interval');
    }

    const range: FeelRange = {
      kind: 'range',
      start: this.evaluate(startNode),
      end: this.evaluate(endNode),
      // `[` and `]` include the endpoint; `(` and the reversed `]` exclude it.
      startIncluded: text.startsWith('['),
      endIncluded: text.endsWith(']'),
    };

    return range;
  }

  /**
   * `x between a and b`, which is `a <= x and x <= b` with FEEL's three-valued
   * conjunction: an undecidable bound makes the whole test null rather than
   * false.
   */
  private between(
    node: SyntaxNode,
    valueNode: SyntaxNode,
    lowNode: SyntaxNode,
    highNode: SyntaxNode | undefined,
  ): FeelValue {
    if (highNode === undefined) {
      return this.unsupported(node, 'between expression');
    }

    const value = this.evaluate(valueNode);
    const low = this.feelCompareOrNull(value, this.evaluate(lowNode));
    const high = this.feelCompareOrNull(this.evaluate(highNode), value);

    if (low === null || high === null) {
      return null;
    }

    return low >= 0 && high >= 0;
  }

  private feelCompareOrNull(left: FeelValue, right: FeelValue): number | null {
    return feelCompare(left, right);
  }

  private contextLiteral(node: SyntaxNode): FeelValue {
    const entries: Record<string, FeelValue> = Object.create(null) as Record<string, FeelValue>;
    // Each entry sees the ones before it, so `{a: 1, b: a + 1}` resolves.
    let scoped: FeelContext = this.context;

    for (const entry of significantChildren(node)) {
      const [keyNode, valueNode] = significantChildren(entry);

      if (keyNode === undefined || valueNode === undefined) {
        this.unsupported(entry, 'context entry');
        continue;
      }

      const key = this.contextKey(keyNode);

      if (FORBIDDEN_KEYS.has(key)) {
        // Model content must not reach object internals.
        this.unsupported(keyNode, `context key ${JSON.stringify(key)}`);
        continue;
      }

      const value = new Evaluator(this.source, scoped).evaluateInto(valueNode, this.warnings);
      entries[key] = value;
      scoped = { ...scoped, [key]: value };
    }

    return entries;
  }

  /** A context key is a name or a string literal; both denote the same key. */
  private contextKey(node: SyntaxNode): string {
    const text = this.text(node).trim();
    return text.startsWith('"') ? unescapeString(text) : text;
  }

  /**
   * `x instance of T`.
   *
   * Only the FEEL type names whose membership this runtime can actually decide
   * are answered; anything else is reported rather than guessed, because a
   * confident wrong answer here silently changes control flow.
   */
  private instanceOf(node: SyntaxNode): FeelValue {
    const children = significantChildren(node).filter(
      (child) => child.name !== 'instance' && child.name !== 'of',
    );
    const [valueNode, typeNode] = children;

    if (valueNode === undefined || typeNode === undefined) {
      return this.unsupported(node, 'instance of expression');
    }

    const typeName = this.text(typeNode).trim().replace(/\s+/gu, ' ');
    const value = this.evaluate(valueNode);

    if (typeName === 'Any') {
      // Every value is an instance of Any, including null.
      return true;
    }

    if (!DECIDABLE_TYPES.has(typeName)) {
      return this.unsupported(typeNode, `instance of ${JSON.stringify(typeName)}`);
    }

    return feelTypeOf(value) === typeName;
  }

  // --- functions ----------------------------------------------------------

  private invocation(node: SyntaxNode): FeelValue {
    const [calleeNode, argumentsNode] = significantChildren(node);

    if (calleeNode === undefined) {
      return this.unsupported(node, 'function invocation');
    }

    const callee = this.evaluate(calleeNode);

    if (!isFeelFunction(callee)) {
      // Reported as an unknown *function* rather than an unknown variable: the
      // usual cause is a FEEL built-in this version does not provide, and that
      // is a failure to evaluate, not a null result.
      this.warn(
        FEEL_DIAGNOSTIC_CODES.FEEL_UNKNOWN_FUNCTION,
        `${JSON.stringify(this.text(calleeNode).trim())} is not a function.`,
        calleeNode,
      );
      return null;
    }

    const args = this.argumentsFor(callee, argumentsNode);

    if (callDepth >= MAX_CALL_DEPTH) {
      this.warn(
        FEEL_DIAGNOSTIC_CODES.FEEL_RECURSION_LIMIT,
        `Invocation nested deeper than ${String(MAX_CALL_DEPTH)} calls.`,
        node,
      );
      return null;
    }

    callDepth += 1;
    try {
      return callee.invoke(args);
    } finally {
      callDepth -= 1;
    }
  }

  /**
   * Resolves an argument list to positional order.
   *
   * Named arguments are matched to the callee's declared parameters, so a
   * function never has to know which syntax invoked it. An unmatched name is
   * reported rather than silently dropped, because a misspelled parameter
   * would otherwise look like a deliberate null.
   */
  private argumentsFor(callee: FeelFunction, node: SyntaxNode | undefined): FeelValue[] {
    if (node === undefined) {
      return [];
    }

    if (node.name === 'PositionalParameters') {
      return significantChildren(node).map((argument) => this.evaluate(argument));
    }

    if (node.name !== 'NamedParameters') {
      this.unsupported(node, `argument list ${node.name}`);
      return [];
    }

    const supplied = new Map<string, FeelValue>();

    for (const parameter of significantChildren(node)) {
      const [nameNode, valueNode] = significantChildren(parameter);
      if (nameNode === undefined || valueNode === undefined) {
        continue;
      }
      supplied.set(this.text(nameNode).trim(), this.evaluate(valueNode));
    }

    for (const name of supplied.keys()) {
      if (!callee.parameters.includes(name)) {
        this.warn(
          FEEL_DIAGNOSTIC_CODES.FEEL_UNKNOWN_VARIABLE,
          `${JSON.stringify(callee.name ?? 'function')} has no parameter ${JSON.stringify(name)}.`,
          node,
        );
      }
    }

    // A parameter with no argument is null, as any absent value is.
    return callee.parameters.map((name) => supplied.get(name) ?? null);
  }

  private functionDefinition(node: SyntaxNode): FeelValue {
    const children = significantChildren(node);

    if (children.some((child) => child.name === 'external')) {
      // `function(x) external { java: {...} }` is the FEEL spelling of
      // functionKind="Java". Executing host code is excluded by design, and
      // returning its descriptor context as data would be worse than refusing:
      // the model asked for a function and would silently receive a map.
      return this.unsupported(node, 'external function binding');
    }

    const formals = children.find((child) => child.name === 'FormalParameters');
    const body = children.find((child) => child.name === 'FunctionBody');

    if (body === undefined) {
      return this.unsupported(node, 'function definition');
    }

    const parameters =
      formals === undefined
        ? []
        : significantChildren(formals).map((parameter) => this.text(parameter).trim());

    const source = this.source;
    const closure = this.context;
    const sink = this.warnings;

    const fn: FeelFunction = {
      kind: 'function',
      parameters,
      invoke(args) {
        // Lexical scoping: the body sees the context the definition was
        // evaluated in, with the parameters bound over it.
        const scoped: Record<string, FeelValue> = Object.create(null) as Record<
          string,
          FeelValue
        >;
        for (const [name, value] of Object.entries(closure)) {
          scoped[name] = value;
        }
        parameters.forEach((name, index) => {
          scoped[name] = args[index] ?? null;
        });

        const outcome = Evaluator.run(source, body, scoped);
        sink.push(...outcome.warnings);
        return outcome.value;
      },
    };

    return fn;
  }

  // --- names --------------------------------------------------------------

  private variable(node: SyntaxNode): FeelValue {
    const name = this.text(node).trim();
    return this.lookup(this.context, name, node);
  }

  private path(node: SyntaxNode): FeelValue {
    const children = significantChildren(node);
    const [targetNode, nameNode] = children;

    if (targetNode === undefined || nameNode === undefined) {
      return this.unsupported(node, 'path expression');
    }

    const target = this.evaluate(targetNode);

    if (target === null) {
      return null;
    }

    // `date.year`, `duration.days` and the like are properties of the value
    // itself rather than entries in a context.
    const property = temporalProperty(target, this.text(nameNode).trim());
    if (property !== undefined) {
      return property;
    }

    if (!isFeelContext(target)) {
      // Path access on a non-context is null, not an error.
      return null;
    }

    return this.lookup(target, this.text(nameNode).trim(), nameNode);
  }

  private lookup(container: FeelContext, name: string, node: SyntaxNode): FeelValue {
    if (FORBIDDEN_KEYS.has(name)) {
      // Model content must not reach object internals.
      return null;
    }

    if (Object.prototype.hasOwnProperty.call(container, name)) {
      return container[name] ?? null;
    }

    // Built-ins are consulted only after the context, so a model variable of
    // the same name shadows one, as FEEL scoping requires.
    if (container === this.context) {
      const builtin = BUILTINS.get(name);
      if (builtin !== undefined) {
        return builtin;
      }
    }

    this.warn(
      FEEL_DIAGNOSTIC_CODES.FEEL_UNKNOWN_VARIABLE,
      `Unknown variable ${JSON.stringify(name)}.`,
      node,
    );
    return null;
  }

  /** Evaluates in this evaluator, forwarding diagnostics to another sink. */
  private evaluateInto(node: SyntaxNode, sink: Diagnostic[]): FeelValue {
    const value = this.evaluate(node);
    sink.push(...this.warnings);
    this.warnings.length = 0;
    return value;
  }

  // --- helpers ------------------------------------------------------------

  private evaluateOnlyChild(node: SyntaxNode): FeelValue {
    const child = significantChildren(node)[0];
    return child === undefined ? null : this.evaluate(child);
  }

  private text(node: SyntaxNode): string {
    return this.source.slice(node.from, node.to);
  }

  private unsupported(node: SyntaxNode, construct: string): null {
    this.warn(
      FEEL_DIAGNOSTIC_CODES.FEEL_UNSUPPORTED_CONSTRUCT,
      `Unsupported FEEL construct: ${construct}.`,
      node,
    );
    return null;
  }

  private warn(code: FeelDiagnosticCode, message: string, node: SyntaxNode): void {
    this.warnings.push({
      code,
      severity: 'WARNING',
      message,
      source: spanFor(this.source, node.from, node.to),
    });
  }
}

function isArithmeticOperator(operator: string): operator is '+' | '-' | '*' | '/' | '**' {
  return (
    operator === '+' ||
    operator === '-' ||
    operator === '*' ||
    operator === '/' ||
    operator === '**'
  );
}

/** Decodes the escape sequences FEEL defines for string literals. */
function unescapeString(literal: string): string {
  const body = literal.slice(1, -1);

  return body.replace(
    /\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{6}|[nrt'"\\])/gu,
    (_match, escape: string) => {
      switch (escape) {
        case 'n':
          return '\n';
        case 'r':
          return '\r';
        case 't':
          return '\t';
        case "'":
          return "'";
        case '"':
          return '"';
        case '\\':
          return '\\';
        default:
          return String.fromCodePoint(Number.parseInt(escape.slice(1), 16));
      }
    },
  );
}

export type { FeelNumber };
