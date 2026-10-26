/**
 * `@smarthorizon-labs/dmn-model`
 *
 * The normalized DMN model: one internal shape into which DMN 1.1 through 1.5
 * documents are loaded.
 *
 * Original work. Modules downstream of normalization must not branch on DMN
 * version; where a construct exists only in later versions, its absence is
 * represented explicitly here rather than through version checks.
 */

/** The DMN version a document was authored against, detected from its namespace. */
export type DmnVersion = '1.1' | '1.2' | '1.3' | '1.4' | '1.5';

export interface SourceLocation {
  readonly line: number;
  readonly column: number;
}

/** Common shape of every named DMN element. */
export interface DmnElement {
  readonly id?: string;
  readonly name?: string;
  readonly location?: SourceLocation;
}

// --- expressions ----------------------------------------------------------

export interface LiteralExpression extends DmnElement {
  readonly kind: 'literalExpression';
  readonly text: string;
  readonly typeRef?: string;
}

export type HitPolicy =
  | 'UNIQUE'
  | 'FIRST'
  | 'PRIORITY'
  | 'ANY'
  | 'COLLECT'
  | 'RULE ORDER'
  | 'OUTPUT ORDER';

export type Aggregation = 'SUM' | 'MIN' | 'MAX' | 'COUNT';

export interface DecisionTableInput extends DmnElement {
  /** The FEEL expression producing the value each rule's entry is tested against. */
  readonly expression: string;
  readonly typeRef?: string;
  /** `inputValues`, when declared. */
  readonly allowedValues?: string;
}

export interface DecisionTableOutput extends DmnElement {
  readonly typeRef?: string;
  /** `outputValues`. Required by PRIORITY and OUTPUT ORDER. */
  readonly outputValues?: string;
  /** Used when no rule matches. */
  readonly defaultOutputEntry?: string;
}

export interface DecisionRule extends DmnElement {
  readonly inputEntries: readonly string[];
  readonly outputEntries: readonly string[];
  readonly annotationEntries: readonly string[];
}

export interface DecisionTable extends DmnElement {
  readonly kind: 'decisionTable';
  readonly hitPolicy: HitPolicy;
  readonly aggregation?: Aggregation;
  readonly inputs: readonly DecisionTableInput[];
  readonly outputs: readonly DecisionTableOutput[];
  readonly rules: readonly DecisionRule[];
  readonly typeRef?: string;
}

export interface ContextEntry {
  readonly name?: string;
  readonly typeRef?: string;
  readonly value: Expression;
}

export interface ContextExpression extends DmnElement {
  readonly kind: 'context';
  readonly entries: readonly ContextEntry[];
  readonly typeRef?: string;
}

export interface ListExpression extends DmnElement {
  readonly kind: 'list';
  readonly items: readonly Expression[];
  readonly typeRef?: string;
}

export interface RelationExpression extends DmnElement {
  readonly kind: 'relation';
  readonly columns: readonly string[];
  readonly rows: readonly (readonly Expression[])[];
  readonly typeRef?: string;
}

export interface FormalParameter {
  readonly name: string;
  readonly typeRef?: string;
}

export interface FunctionDefinition extends DmnElement {
  readonly kind: 'functionDefinition';
  /**
   * `FEEL`, `Java` or `PMML`. Only `FEEL` is executable; the others are
   * reported as unsupported rather than executed.
   */
  readonly functionKind: string;
  readonly parameters: readonly FormalParameter[];
  readonly body?: Expression;
  readonly typeRef?: string;
}

export interface Binding {
  readonly parameter: string;
  readonly value?: Expression;
}

export interface InvocationExpression extends DmnElement {
  readonly kind: 'invocation';
  readonly called?: Expression;
  readonly bindings: readonly Binding[];
  readonly typeRef?: string;
}

/** DMN 1.5 boxed conditional. */
export interface ConditionalExpression extends DmnElement {
  readonly kind: 'conditional';
  readonly condition?: Expression;
  readonly then?: Expression;
  readonly else?: Expression;
  readonly typeRef?: string;
}

/** DMN 1.5 boxed filter. */
export interface FilterExpression extends DmnElement {
  readonly kind: 'filter';
  readonly in?: Expression;
  readonly match?: Expression;
  readonly typeRef?: string;
}

/** DMN 1.5 boxed iterator: `for`, `every`, `some`. */
export interface IteratorExpression extends DmnElement {
  readonly kind: 'iterator';
  readonly iteratorKind: 'for' | 'every' | 'some';
  readonly variable?: string;
  readonly in?: Expression;
  readonly body?: Expression;
  readonly typeRef?: string;
}

/**
 * A recognized element the loader could not normalize into an executable
 * expression. Preserved rather than dropped, so the runtime can report
 * precisely what it declined to evaluate.
 */
export interface UnsupportedExpression extends DmnElement {
  readonly kind: 'unsupported';
  readonly elementName: string;
  readonly typeRef?: string;
}

export type Expression =
  | LiteralExpression
  | DecisionTable
  | ContextExpression
  | ListExpression
  | RelationExpression
  | FunctionDefinition
  | InvocationExpression
  | ConditionalExpression
  | FilterExpression
  | IteratorExpression
  | UnsupportedExpression;

// --- DRG elements ---------------------------------------------------------

export interface Variable {
  readonly name?: string;
  readonly typeRef?: string;
}

export interface InputData extends DmnElement {
  readonly variable?: Variable;
}

/** An `href` reference, split into its document and element parts. */
export interface Reference {
  readonly href: string;
  /** The fragment, without the leading `#`. */
  readonly id: string;
  /** Present when the reference crosses a document boundary. */
  readonly namespace?: string;
}

export interface Requirements {
  readonly requiredInputs: readonly Reference[];
  readonly requiredDecisions: readonly Reference[];
  readonly requiredKnowledge: readonly Reference[];
}

export interface Decision extends DmnElement {
  readonly variable?: Variable;
  readonly requirements: Requirements;
  readonly expression?: Expression;
}

export interface BusinessKnowledgeModel extends DmnElement {
  readonly variable?: Variable;
  readonly requirements: Requirements;
  readonly encapsulatedLogic?: FunctionDefinition;
}

export interface DecisionService extends DmnElement {
  readonly variable?: Variable;
  readonly outputDecisions: readonly Reference[];
  readonly encapsulatedDecisions: readonly Reference[];
  readonly inputDecisions: readonly Reference[];
  readonly inputData: readonly Reference[];
}

export interface ItemComponent {
  readonly name?: string;
  readonly typeRef?: string;
  readonly isCollection: boolean;
  readonly allowedValues?: string;
  readonly components: readonly ItemComponent[];
}

export interface ItemDefinition extends DmnElement {
  readonly typeRef?: string;
  readonly isCollection: boolean;
  readonly allowedValues?: string;
  readonly components: readonly ItemComponent[];
}

export interface Import extends DmnElement {
  readonly namespace: string;
  readonly locationURI?: string;
  readonly importType: string;
}

export interface DmnModel {
  readonly dmnVersion: DmnVersion;
  readonly id?: string;
  readonly name?: string;
  readonly namespace: string;
  readonly expressionLanguage?: string;
  readonly imports: readonly Import[];
  readonly itemDefinitions: readonly ItemDefinition[];
  readonly inputData: readonly InputData[];
  readonly decisions: readonly Decision[];
  readonly businessKnowledgeModels: readonly BusinessKnowledgeModel[];
  readonly decisionServices: readonly DecisionService[];
}

// --- lookups --------------------------------------------------------------

export type DrgElement = InputData | Decision | BusinessKnowledgeModel | DecisionService;

export interface ModelIndex {
  readonly byId: ReadonlyMap<string, DrgElement>;
  readonly byName: ReadonlyMap<string, DrgElement>;
  /** Names defined more than once; addressing these by name is ambiguous. */
  readonly duplicateNames: readonly string[];
}

/**
 * Indexes a model by ID and by name.
 *
 * Duplicate names are collected rather than silently resolved: a request
 * addressing an ambiguous name must fail rather than pick.
 */
export function indexModel(model: DmnModel): ModelIndex {
  const byId = new Map<string, DrgElement>();
  const byName = new Map<string, DrgElement>();
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  const elements: readonly DrgElement[] = [
    ...model.inputData,
    ...model.decisions,
    ...model.businessKnowledgeModels,
    ...model.decisionServices,
  ];

  for (const element of elements) {
    if (element.id !== undefined) {
      byId.set(element.id, element);
    }

    const name = element.name;
    if (name !== undefined) {
      if (seen.has(name)) {
        duplicates.add(name);
      }
      seen.add(name);
      byName.set(name, element);
    }
  }

  return { byId, byName, duplicateNames: [...duplicates] };
}

export function isDecision(element: DrgElement): element is Decision {
  return 'requirements' in element && !('encapsulatedLogic' in element);
}

export function isBusinessKnowledgeModel(
  element: DrgElement,
): element is BusinessKnowledgeModel {
  return 'encapsulatedLogic' in element;
}

export function isDecisionService(element: DrgElement): element is DecisionService {
  return 'outputDecisions' in element;
}

export function isInputData(element: DrgElement): element is InputData {
  return !('requirements' in element) && !('outputDecisions' in element);
}
