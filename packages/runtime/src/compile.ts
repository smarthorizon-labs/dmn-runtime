/**
 * Compilation: normalized model to immutable executable form.
 *
 * Original work. Every FEEL expression in the
 * model is compiled exactly once, here, against the scope it will be evaluated
 * in. This is what makes repeated evaluation parse-free.
 */

import {
  createFeelEngine,
  type CompiledFeelExpression,
  type CompiledFeelUnaryTests,
  type Diagnostic,
  type FeelEngine,
  type FeelScope,
} from '@smarthorizon-labs/dmn-feel';
import {
  indexModel,
  type Decision,
  type DecisionTable,
  type DmnModel,
  type Expression,
  type ModelIndex,
} from '@smarthorizon-labs/dmn-model';

export interface CompiledLiteral {
  readonly kind: 'literal';
  readonly expression: CompiledFeelExpression;
}

export interface CompiledRule {
  readonly id: string | undefined;
  readonly index: number;
  readonly inputEntries: readonly CompiledFeelUnaryTests[];
  readonly outputEntries: readonly CompiledFeelExpression[];
}

export interface CompiledOutputClause {
  readonly name: string | undefined;
  /** Priority order for PRIORITY and OUTPUT ORDER, taken from `outputValues`. */
  readonly outputOrder: readonly CompiledFeelExpression[];
  readonly defaultOutputEntry: CompiledFeelExpression | undefined;
}

export interface CompiledTable {
  readonly kind: 'table';
  readonly table: DecisionTable;
  readonly inputs: readonly CompiledFeelExpression[];
  readonly outputs: readonly CompiledOutputClause[];
  readonly rules: readonly CompiledRule[];
}

export interface CompiledContextEntry {
  readonly name: string | undefined;
  readonly value: CompiledExpression;
}

export interface CompiledContext {
  readonly kind: 'context';
  readonly entries: readonly CompiledContextEntry[];
}

export interface CompiledList {
  readonly kind: 'list';
  readonly items: readonly CompiledExpression[];
}

export interface CompiledBinding {
  readonly parameter: string;
  readonly value: CompiledExpression;
}

/** A boxed `<invocation>`: a named callee with named argument bindings. */
export interface CompiledInvocation {
  readonly kind: 'invocation';
  readonly callee: CompiledExpression | undefined;
  readonly bindings: readonly CompiledBinding[];
}

/** A boxed `<functionDefinition>`, or a BKM's encapsulated logic. */
export interface CompiledFunction {
  readonly kind: 'function';
  readonly name: string | undefined;
  readonly parameters: readonly string[];
  readonly body: CompiledExpression;
}

export interface CompiledUnsupported {
  readonly kind: 'unsupported';
  readonly reason: string;
}

export type CompiledExpression =
  | CompiledLiteral
  | CompiledTable
  | CompiledContext
  | CompiledList
  | CompiledInvocation
  | CompiledFunction
  | CompiledUnsupported;

export interface CompiledDecision {
  readonly id: string;
  readonly name: string;
  readonly decision: Decision;
  /** Names of the input data this decision reads directly. */
  readonly requiredInputNames: readonly string[];
  /** Ids of the decisions this decision reads directly. */
  readonly requiredDecisionIds: readonly string[];
  readonly expression: CompiledExpression;
  /** The decision variable's declared type, for result coercion. */
  readonly typeRef: string | undefined;
  readonly typeShape: TypeShape | undefined;
}

export interface CompiledBkm {
  readonly id: string;
  readonly name: string;
  readonly parameters: readonly string[];
  readonly body: CompiledExpression;
}

/**
 * A decision service's boundary.
 *
 * A service is not a named subset of decisions; it is an encapsulation. Its
 * inputs are exactly what it declares, and an `inputDecision` is a *parameter*
 * — supplied by the caller, never evaluated.
 */
export interface CompiledDecisionService {
  readonly id: string;
  readonly name: string;
  readonly outputDecisionIds: readonly string[];
  /** Ids the caller supplies values for, so evaluation stops at them. */
  readonly inputDecisionIds: readonly string[];
  readonly inputDecisionNames: readonly string[];
  readonly inputDataNames: readonly string[];
}

export interface CompiledDmnModel {
  readonly model: DmnModel;
  readonly index: ModelIndex;
  readonly decisions: ReadonlyMap<string, CompiledDecision>;
  readonly types: TypeTable;
  /** Business knowledge models, keyed by name. */
  readonly bkms: ReadonlyMap<string, CompiledBkm>;
  /** Keyed by service name, and additionally by id. */
  readonly services: ReadonlyMap<string, CompiledDecisionService>;
  /** Decision ids in dependency order: every decision follows its requirements. */
  readonly order: readonly string[];
  readonly inputDataNames: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
  readonly engine: FeelEngine;
}

export interface CompileOptions {
  readonly engine?: FeelEngine;
}

export function compileModel(model: DmnModel, options: CompileOptions = {}): CompiledDmnModel {
  const engine = options.engine ?? createFeelEngine();
  const index = indexModel(model);
  const diagnostics: Diagnostic[] = [];

  // The DRG scope: every name an expression in this model may reference.
  const scope: FeelScope = {
    names: [
      ...model.inputData.map((input) => input.variable?.name ?? input.name),
      ...model.decisions.map((decision) => decision.variable?.name ?? decision.name),
      ...model.businessKnowledgeModels.map((bkm) => bkm.name),
      ...model.decisionServices.map((service) => service.name),
    ].filter((name): name is string => name !== undefined),
  };

  const types = buildTypeTable(model);
  const decisions = new Map<string, CompiledDecision>();

  for (const decision of model.decisions) {
    const id = decision.id ?? decision.name ?? '';
    const name = decision.variable?.name ?? decision.name ?? id;
    const typeRef = decision.variable?.typeRef;

    const expression =
      decision.expression === undefined
        ? ({ kind: 'unsupported', reason: 'decision has no expression' } as const)
        : compileExpression(decision.expression, scope, engine, diagnostics);

    decisions.set(id, {
      id,
      name,
      decision,
      requiredInputNames: decision.requirements.requiredInputs
        .map((reference) => nameOfReference(index, reference.id))
        .filter((value): value is string => value !== undefined),
      requiredDecisionIds: decision.requirements.requiredDecisions.map(
        (reference) => reference.id,
      ),
      expression,
      typeRef,
      typeShape: typeRef === undefined ? undefined : (types.get(typeRef) ?? { isCollection: false }),
    });
  }

  const bkms = new Map<string, CompiledBkm>();

  for (const bkm of model.businessKnowledgeModels) {
    const name = bkm.name ?? bkm.id ?? '';
    const logic = bkm.encapsulatedLogic;
    const parameters = logic?.parameters.map((parameter) => parameter.name) ?? [];

    // The body sees the DRG plus its own parameters.
    const bodyScope: FeelScope = { names: [...scope.names, ...parameters] };

    const body =
      logic === undefined
        ? ({ kind: 'unsupported', reason: 'business knowledge model has no logic' } as const)
        : logic.functionKind !== 'FEEL'
          ? ({
              kind: 'unsupported',
              // A model must never name host code to execute.
              reason: `functionKind ${JSON.stringify(logic.functionKind)} is not executable`,
            } as const)
          : logic.body === undefined
            ? ({ kind: 'unsupported', reason: 'function definition has no body' } as const)
            : compileExpression(logic.body, bodyScope, engine, diagnostics);

    bkms.set(name, { id: bkm.id ?? '', name, parameters, body });
  }

  const services = new Map<string, CompiledDecisionService>();

  for (const service of model.decisionServices) {
    const compiled: CompiledDecisionService = {
      id: service.id ?? '',
      name: service.name ?? service.id ?? '',
      outputDecisionIds: service.outputDecisions.map((reference) => reference.id),
      inputDecisionIds: service.inputDecisions.map((reference) => reference.id),
      inputDecisionNames: service.inputDecisions
        .map((reference) => nameOfReference(index, reference.id))
        .filter((name): name is string => name !== undefined),
      inputDataNames: service.inputData
        .map((reference) => nameOfReference(index, reference.id))
        .filter((name): name is string => name !== undefined),
    };

    services.set(compiled.name, compiled);
    if (compiled.id !== '') {
      services.set(compiled.id, compiled);
    }
  }

  return {
    model,
    index,
    decisions,
    types,
    bkms,
    services,
    order: topologicalOrder(decisions),
    inputDataNames: model.inputData
      .map((input) => input.variable?.name ?? input.name)
      .filter((name): name is string => name !== undefined),
    diagnostics,
    engine,
  };
}

function nameOfReference(index: ModelIndex, id: string): string | undefined {
  const element = index.byId.get(id);
  if (element === undefined) {
    return undefined;
  }
  return 'variable' in element ? (element.variable?.name ?? element.name) : element.name;
}

/**
 * Orders decisions so that each follows everything it requires.
 *
 * Cycles are not valid in a DRG. Rather than throwing, the participating
 * decisions are appended in declaration order; evaluation then reports them as
 * unresolved, which keeps one malformed model from failing an entire run.
 */
function topologicalOrder(decisions: ReadonlyMap<string, CompiledDecision>): readonly string[] {
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  function visit(id: string): void {
    const status = state.get(id);
    if (status === 'done' || status === 'visiting') {
      return;
    }

    const decision = decisions.get(id);
    if (decision === undefined) {
      return;
    }

    state.set(id, 'visiting');
    for (const dependency of decision.requiredDecisionIds) {
      visit(dependency);
    }
    state.set(id, 'done');
    order.push(id);
  }

  for (const id of decisions.keys()) {
    visit(id);
  }

  return order;
}

// --- expression compilation ----------------------------------------------

function compileExpression(
  expression: Expression,
  scope: FeelScope,
  engine: FeelEngine,
  diagnostics: Diagnostic[],
): CompiledExpression {
  switch (expression.kind) {
    case 'literalExpression': {
      const compiled = engine.compileExpression(expression.text, scope);
      diagnostics.push(...compiled.diagnostics);
      return { kind: 'literal', expression: compiled };
    }

    case 'decisionTable':
      return compileTable(expression, scope, engine, diagnostics);

    case 'context': {
      // Each entry sees the names bound by the entries before it.
      const names = [...scope.names];
      const entries = expression.entries.map((entry) => {
        const entryScope: FeelScope = { names: [...names] };
        const value = compileExpression(entry.value, entryScope, engine, diagnostics);
        if (entry.name !== undefined) {
          names.push(entry.name);
        }
        return { name: entry.name, value };
      });

      return { kind: 'context', entries };
    }

    case 'list':
      return {
        kind: 'list',
        items: expression.items.map((item) =>
          compileExpression(item, scope, engine, diagnostics),
        ),
      };

    case 'invocation':
      return {
        kind: 'invocation',
        callee:
          expression.called === undefined
            ? undefined
            : compileExpression(expression.called, scope, engine, diagnostics),
        bindings: expression.bindings.map((binding) => ({
          parameter: binding.parameter,
          value:
            binding.value === undefined
              ? ({ kind: 'unsupported', reason: 'binding has no value' } as const)
              : compileExpression(binding.value, scope, engine, diagnostics),
        })),
      };

    case 'functionDefinition': {
      if (expression.functionKind !== 'FEEL') {
        return {
          kind: 'unsupported',
          reason: `functionKind ${JSON.stringify(expression.functionKind)} is not executable`,
        };
      }

      const parameters = expression.parameters.map((parameter) => parameter.name);
      const bodyScope: FeelScope = { names: [...scope.names, ...parameters] };

      return {
        kind: 'function',
        name: expression.name,
        parameters,
        body:
          expression.body === undefined
            ? { kind: 'unsupported', reason: 'function definition has no body' }
            : compileExpression(expression.body, bodyScope, engine, diagnostics),
      };
    }

    default:
      return {
        kind: 'unsupported',
        reason:
          expression.kind === 'unsupported'
            ? `<${expression.elementName}> is not supported`
            : `${expression.kind} expressions are not supported`,
      };
  }
}

function compileTable(
  table: DecisionTable,
  scope: FeelScope,
  engine: FeelEngine,
  diagnostics: Diagnostic[],
): CompiledTable {
  const inputs = table.inputs.map((input) => {
    const compiled = engine.compileExpression(input.expression, scope);
    diagnostics.push(...compiled.diagnostics);
    return compiled;
  });

  const outputs: CompiledOutputClause[] = table.outputs.map((output) => ({
    name: output.name,
    outputOrder:
      output.outputValues === undefined
        ? []
        : splitOutputValues(output.outputValues).map((value) =>
            engine.compileExpression(value, scope),
          ),
    defaultOutputEntry:
      output.defaultOutputEntry === undefined
        ? undefined
        : engine.compileExpression(output.defaultOutputEntry, scope),
  }));

  const rules: CompiledRule[] = table.rules.map((rule, index) => ({
    id: rule.id,
    index,
    inputEntries: rule.inputEntries.map((entry) => {
      const compiled = engine.compileUnaryTests(entry, scope);
      diagnostics.push(...compiled.diagnostics);
      return compiled;
    }),
    outputEntries: rule.outputEntries.map((entry) => {
      const compiled = engine.compileExpression(entry, scope);
      diagnostics.push(...compiled.diagnostics);
      return compiled;
    }),
  }));

  return { kind: 'table', table, inputs, outputs, rules };
}

/** Scalar FEEL types whose membership this runtime can decide. */
export type ScalarType = 'string' | 'number' | 'boolean';

/**
 * What a declared type requires of a value.
 *
 * `scalar` is present only when conformance is actually checkable. For a
 * structured type, a temporal type, or a name that resolves to nothing, it is
 * absent and the value is accepted — a value is only rejected when the engine
 * can be sure it does not conform.
 */
export interface TypeShape {
  readonly isCollection: boolean;
  /** For a collection, the element type; otherwise the type itself. */
  readonly scalar?: ScalarType;
}

const SCALARS = new Set<string>(['string', 'number', 'boolean']);

export type TypeTable = ReadonlyMap<string, TypeShape>;

/**
 * Resolves every declared type to the shape the coercion rules need.
 *
 * An item definition may alias another, so resolution follows `typeRef` with a
 * visited set — a malformed model can make that cyclic.
 */
function buildTypeTable(model: DmnModel): TypeTable {
  const definitions = new Map(
    model.itemDefinitions
      .filter((definition) => definition.name !== undefined)
      .map((definition) => [definition.name as string, definition]),
  );

  const shapes = new Map<string, TypeShape>();

  function resolve(name: string, seen: Set<string>): TypeShape {
    if (seen.has(name)) {
      return { isCollection: false };
    }
    seen.add(name);

    if (SCALARS.has(name)) {
      return { isCollection: false, scalar: name as ScalarType };
    }

    const definition = definitions.get(name);

    if (definition === undefined) {
      // A built-in this runtime cannot check, or an unknown name.
      return { isCollection: false };
    }

    // A structured type has components; its element type is not a scalar.
    if (definition.components.length > 0) {
      return { isCollection: definition.isCollection };
    }

    const element =
      definition.typeRef === undefined
        ? { isCollection: false }
        : resolve(definition.typeRef, seen);

    if (!definition.isCollection) {
      return element;
    }

    // The element type carries forward only when it is itself scalar. A list
    // of lists has list-valued elements, and inheriting the inner scalar would
    // make every element look non-conforming.
    return element.isCollection || element.scalar === undefined
      ? { isCollection: true }
      : { isCollection: true, scalar: element.scalar };
  }

  for (const name of definitions.keys()) {
    shapes.set(name, resolve(name, new Set()));
  }

  for (const name of SCALARS) {
    shapes.set(name, { isCollection: false, scalar: name as ScalarType });
  }

  return shapes;
}

/**
 * Splits an `outputValues` list into its individual FEEL expressions.
 *
 * The list is comma-separated, but commas inside string literals and brackets
 * must not split it.
 */
export function splitOutputValues(source: string): readonly string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | undefined;

  for (const character of source) {
    if (quote !== undefined) {
      current += character;
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }

    if (character === '[' || character === '(' || character === '{') depth++;
    if (character === ']' || character === ')' || character === '}') depth--;

    if (character === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  if (current.trim() !== '') {
    parts.push(current.trim());
  }

  return parts;
}
