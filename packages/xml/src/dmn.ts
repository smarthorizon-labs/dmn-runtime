/**
 * DMN XML to normalized model.
 *
 * Original work. Version-aware by design: DMN 1.1 through 1.5 documents are
 * detected from the root namespace and normalized into one internal shape, so
 * that no module downstream branches on version.
 */

import type {
  Aggregation,
  Binding,
  BusinessKnowledgeModel,
  ContextEntry,
  Decision,
  DecisionRule,
  DecisionService,
  DecisionTable,
  DecisionTableInput,
  DecisionTableOutput,
  DmnModel,
  DmnVersion,
  Expression,
  FormalParameter,
  FunctionDefinition,
  Import,
  InputData,
  ItemComponent,
  ItemDefinition,
  Reference,
  Requirements,
  SourceLocation,
  Variable,
} from '@smarthorizon-labs/dmn-model';

import {
  attribute,
  childNamed,
  childrenNamed,
  parseXml,
  textOfChild,
  type XmlElement,
  type XmlLimits,
} from './secure-xml.js';

/** Model namespaces, normalized to scheme-less, slash-less form. */
const VERSION_BY_NAMESPACE = new Map<string, DmnVersion>([
  ['www.omg.org/spec/DMN/20151101/dmn.xsd', '1.1'],
  ['www.omg.org/spec/DMN/20180521/MODEL', '1.2'],
  ['www.omg.org/spec/DMN/20191111/MODEL', '1.3'],
  ['www.omg.org/spec/DMN/20211108/MODEL', '1.4'],
  ['www.omg.org/spec/DMN/20230324/MODEL', '1.5'],
]);

export class DmnLoadError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'DmnLoadError';
  }
}

export function detectDmnVersion(namespaceUri: string): DmnVersion | undefined {
  const normalized = namespaceUri.replace(/^https?:\/\//u, '').replace(/\/$/u, '');
  return VERSION_BY_NAMESPACE.get(normalized);
}

export function loadDmnXml(source: string, limits?: XmlLimits): DmnModel {
  const root = limits === undefined ? parseXml(source) : parseXml(source, limits);

  if (root.local !== 'definitions') {
    throw new DmnLoadError(
      `Expected a <definitions> root element, found <${root.local}>.`,
      'MODEL_NOT_A_DMN_DOCUMENT',
    );
  }

  const dmnVersion = detectDmnVersion(root.uri);
  if (dmnVersion === undefined) {
    throw new DmnLoadError(
      `Unrecognized DMN namespace ${JSON.stringify(root.uri)}. Supported versions are 1.1 through 1.5.`,
      'MODEL_UNSUPPORTED_DMN_VERSION',
    );
  }

  return {
    dmnVersion,
    ...optional('id', attribute(root, 'id')),
    ...optional('name', attribute(root, 'name')),
    namespace: attribute(root, 'namespace') ?? '',
    ...optional('expressionLanguage', attribute(root, 'expressionLanguage')),
    imports: childrenNamed(root, 'import').map(readImport),
    itemDefinitions: childrenNamed(root, 'itemDefinition').map(readItemDefinition),
    inputData: childrenNamed(root, 'inputData').map(readInputData),
    decisions: childrenNamed(root, 'decision').map(readDecision),
    businessKnowledgeModels: childrenNamed(root, 'businessKnowledgeModel').map(readBkm),
    decisionServices: childrenNamed(root, 'decisionService').map(readDecisionService),
  };
}

// --- element readers ------------------------------------------------------

function locationOf(element: XmlElement): SourceLocation {
  return { line: element.line, column: element.column };
}

function base(element: XmlElement): { id?: string; name?: string; location: SourceLocation } {
  return {
    ...optional('id', attribute(element, 'id')),
    ...optional('name', attribute(element, 'name')),
    location: locationOf(element),
  };
}

function readImport(element: XmlElement): Import {
  return {
    ...base(element),
    namespace: attribute(element, 'namespace') ?? '',
    ...optional('locationURI', attribute(element, 'locationURI')),
    importType: attribute(element, 'importType') ?? '',
  };
}

/**
 * `typeRef` appears as a child element on item definitions and as an attribute
 * on variables and clauses. DMN 1.1 additionally prefixes built-in type names
 * with `feel:`.
 */
function readTypeRef(element: XmlElement): string | undefined {
  const raw = textOfChild(element, 'typeRef') ?? attribute(element, 'typeRef');
  if (raw === undefined || raw === '') {
    return undefined;
  }
  return raw.replace(/^feel:/u, '');
}

function readVariable(element: XmlElement): Variable | undefined {
  const variable = childNamed(element, 'variable');
  if (variable === undefined) {
    return undefined;
  }

  return {
    ...optional('name', attribute(variable, 'name')),
    ...optional('typeRef', readTypeRef(variable)),
  };
}

function readItemComponent(element: XmlElement): ItemComponent {
  return {
    ...optional('name', attribute(element, 'name')),
    ...optional('typeRef', readTypeRef(element)),
    isCollection: attribute(element, 'isCollection') === 'true',
    ...optional('allowedValues', nestedText(element, 'allowedValues')),
    components: childrenNamed(element, 'itemComponent').map(readItemComponent),
  };
}

function readItemDefinition(element: XmlElement): ItemDefinition {
  return {
    ...base(element),
    ...optional('typeRef', readTypeRef(element)),
    isCollection: attribute(element, 'isCollection') === 'true',
    ...optional('allowedValues', nestedText(element, 'allowedValues')),
    components: childrenNamed(element, 'itemComponent').map(readItemComponent),
  };
}

function readInputData(element: XmlElement): InputData {
  return { ...base(element), ...optional('variable', readVariable(element)) };
}

function readReference(element: XmlElement): Reference {
  const href = attribute(element, 'href') ?? '';
  const hash = href.indexOf('#');

  if (hash < 0) {
    return { href, id: href };
  }

  const namespace = href.slice(0, hash);
  const id = href.slice(hash + 1);

  return namespace === '' ? { href, id } : { href, id, namespace };
}

function readRequirements(element: XmlElement): Requirements {
  const information = childrenNamed(element, 'informationRequirement');
  const knowledge = childrenNamed(element, 'knowledgeRequirement');

  return {
    requiredInputs: information.flatMap((requirement) =>
      childrenNamed(requirement, 'requiredInput').map(readReference),
    ),
    requiredDecisions: information.flatMap((requirement) =>
      childrenNamed(requirement, 'requiredDecision').map(readReference),
    ),
    requiredKnowledge: knowledge.flatMap((requirement) =>
      childrenNamed(requirement, 'requiredKnowledge').map(readReference),
    ),
  };
}

function readDecision(element: XmlElement): Decision {
  return {
    ...base(element),
    ...optional('variable', readVariable(element)),
    requirements: readRequirements(element),
    ...optional('expression', readExpressionChild(element)),
  };
}

function readBkm(element: XmlElement): BusinessKnowledgeModel {
  const logic = childNamed(element, 'encapsulatedLogic');

  return {
    ...base(element),
    ...optional('variable', readVariable(element)),
    requirements: readRequirements(element),
    ...optional('encapsulatedLogic', logic === undefined ? undefined : readFunction(logic)),
  };
}

function readDecisionService(element: XmlElement): DecisionService {
  return {
    ...base(element),
    ...optional('variable', readVariable(element)),
    outputDecisions: childrenNamed(element, 'outputDecision').map(readReference),
    encapsulatedDecisions: childrenNamed(element, 'encapsulatedDecision').map(readReference),
    inputDecisions: childrenNamed(element, 'inputDecision').map(readReference),
    inputData: childrenNamed(element, 'inputData').map(readReference),
  };
}

// --- expressions ----------------------------------------------------------

const EXPRESSION_ELEMENTS = new Set([
  'literalExpression',
  'decisionTable',
  'context',
  'invocation',
  'relation',
  'list',
  'functionDefinition',
  'conditional',
  'filter',
  'for',
  'every',
  'some',
]);

function readExpressionChild(element: XmlElement): Expression | undefined {
  const child = element.children.find((candidate) => EXPRESSION_ELEMENTS.has(candidate.local));
  return child === undefined ? undefined : readExpression(child);
}

export function readExpression(element: XmlElement): Expression {
  switch (element.local) {
    case 'literalExpression':
      return {
        kind: 'literalExpression',
        ...base(element),
        text: textOfChild(element, 'text') ?? '',
        ...optional('typeRef', readTypeRef(element)),
      };

    case 'decisionTable':
      return readDecisionTable(element);

    case 'context':
      return {
        kind: 'context',
        ...base(element),
        entries: childrenNamed(element, 'contextEntry').map(readContextEntry),
        ...optional('typeRef', readTypeRef(element)),
      };

    case 'list':
      return {
        kind: 'list',
        ...base(element),
        items: element.children
          .filter((child) => EXPRESSION_ELEMENTS.has(child.local))
          .map(readExpression),
        ...optional('typeRef', readTypeRef(element)),
      };

    case 'relation':
      return {
        kind: 'relation',
        ...base(element),
        columns: childrenNamed(element, 'column').map(
          (column) => attribute(column, 'name') ?? '',
        ),
        rows: childrenNamed(element, 'row').map((row) =>
          row.children.filter((cell) => EXPRESSION_ELEMENTS.has(cell.local)).map(readExpression),
        ),
        ...optional('typeRef', readTypeRef(element)),
      };

    case 'functionDefinition':
      return readFunction(element);

    case 'invocation':
      return {
        kind: 'invocation',
        ...base(element),
        ...optional('called', readExpressionChild(element)),
        bindings: childrenNamed(element, 'binding').map(readBinding),
        ...optional('typeRef', readTypeRef(element)),
      };

    case 'conditional':
      return {
        kind: 'conditional',
        ...base(element),
        ...optional('condition', readNestedExpression(element, 'if')),
        ...optional('then', readNestedExpression(element, 'then')),
        ...optional('else', readNestedExpression(element, 'else')),
        ...optional('typeRef', readTypeRef(element)),
      };

    case 'filter':
      return {
        kind: 'filter',
        ...base(element),
        ...optional('in', readNestedExpression(element, 'in')),
        ...optional('match', readNestedExpression(element, 'match')),
        ...optional('typeRef', readTypeRef(element)),
      };

    case 'for':
    case 'every':
    case 'some':
      return {
        kind: 'iterator',
        iteratorKind: element.local,
        ...base(element),
        ...optional('variable', textOfChild(element, 'iteratorVariable')),
        ...optional('in', readNestedExpression(element, 'in')),
        ...optional(
          'body',
          readNestedExpression(element, element.local === 'for' ? 'return' : 'satisfies'),
        ),
        ...optional('typeRef', readTypeRef(element)),
      };

    default:
      return {
        kind: 'unsupported',
        ...base(element),
        elementName: element.local,
        ...optional('typeRef', readTypeRef(element)),
      };
  }
}

/** The boxed 1.5 forms wrap each part in a named holder element. */
function readNestedExpression(element: XmlElement, part: string): Expression | undefined {
  const holder = childNamed(element, part);
  return holder === undefined ? undefined : readExpressionChild(holder);
}

function readContextEntry(element: XmlElement): ContextEntry {
  const variable = childNamed(element, 'variable');
  const value = readExpressionChild(element);

  return {
    ...optional('name', variable === undefined ? undefined : attribute(variable, 'name')),
    ...optional('typeRef', variable === undefined ? undefined : readTypeRef(variable)),
    value: value ?? { kind: 'unsupported', elementName: 'contextEntry', location: locationOf(element) },
  };
}

function readBinding(element: XmlElement): Binding {
  const parameter = childNamed(element, 'parameter');

  return {
    parameter: parameter === undefined ? '' : (attribute(parameter, 'name') ?? ''),
    ...optional('value', readExpressionChild(element)),
  };
}

function readFunction(element: XmlElement): FunctionDefinition {
  const parameters: FormalParameter[] = childrenNamed(element, 'formalParameter').map(
    (parameter) => ({
      name: attribute(parameter, 'name') ?? '',
      ...optional('typeRef', readTypeRef(parameter)),
    }),
  );

  return {
    kind: 'functionDefinition',
    ...base(element),
    // Absent `kind` means FEEL (DMN 1.5 default).
    functionKind: attribute(element, 'kind') ?? 'FEEL',
    parameters,
    ...optional('body', readExpressionChild(element)),
    ...optional('typeRef', readTypeRef(element)),
  };
}

const HIT_POLICIES = new Set([
  'UNIQUE',
  'FIRST',
  'PRIORITY',
  'ANY',
  'COLLECT',
  'RULE ORDER',
  'OUTPUT ORDER',
]);

const AGGREGATIONS = new Set(['SUM', 'MIN', 'MAX', 'COUNT']);

function readDecisionTable(element: XmlElement): DecisionTable {
  const declared = attribute(element, 'hitPolicy')?.toUpperCase();
  // `hitPolicy` is optional and defaults to UNIQUE. The default is
  // materialized here so the runtime never sees `undefined`.
  const hitPolicy = declared !== undefined && HIT_POLICIES.has(declared) ? declared : 'UNIQUE';

  const declaredAggregation = attribute(element, 'aggregation')?.toUpperCase();
  const aggregation =
    declaredAggregation !== undefined && AGGREGATIONS.has(declaredAggregation)
      ? declaredAggregation
      : undefined;

  const inputs: DecisionTableInput[] = childrenNamed(element, 'input').map((input) => {
    const expression = childNamed(input, 'inputExpression');

    return {
      ...base(input),
      expression: expression === undefined ? '' : (textOfChild(expression, 'text') ?? ''),
      ...optional('typeRef', expression === undefined ? undefined : readTypeRef(expression)),
      ...optional('allowedValues', nestedText(input, 'inputValues')),
    };
  });

  const outputs: DecisionTableOutput[] = childrenNamed(element, 'output').map((output) => ({
    ...base(output),
    ...optional('typeRef', readTypeRef(output)),
    ...optional('outputValues', nestedText(output, 'outputValues')),
    ...optional('defaultOutputEntry', nestedText(output, 'defaultOutputEntry')),
  }));

  const rules: DecisionRule[] = childrenNamed(element, 'rule').map((rule) => ({
    ...base(rule),
    inputEntries: childrenNamed(rule, 'inputEntry').map((entry) => entryText(entry)),
    outputEntries: childrenNamed(rule, 'outputEntry').map((entry) => entryText(entry)),
    annotationEntries: childrenNamed(rule, 'annotationEntry').map((entry) => entryText(entry)),
  }));

  return {
    kind: 'decisionTable',
    ...base(element),
    hitPolicy: hitPolicy as DecisionTable['hitPolicy'],
    ...optional('aggregation', aggregation as Aggregation | undefined),
    inputs,
    outputs,
    rules,
    ...optional('typeRef', readTypeRef(element)),
  };
}

/** `outputValues` and `defaultOutputEntry` wrap their FEEL in a `<text>` child. */
function nestedText(element: XmlElement, local: string): string | undefined {
  const holder = childNamed(element, local);
  if (holder === undefined) {
    return undefined;
  }
  return textOfChild(holder, 'text') ?? holder.text.trim();
}

function entryText(entry: XmlElement): string {
  return textOfChild(entry, 'text') ?? entry.text.trim();
}

/**
 * Builds `{ key: value }` when the value is defined, and `{}` when it is not.
 *
 * `exactOptionalPropertyTypes` distinguishes an absent property from one
 * explicitly set to `undefined`; this keeps the normalized model free of the
 * latter.
 */
function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
