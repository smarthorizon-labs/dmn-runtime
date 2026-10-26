/**
 * Reads the DMN TCK test-case format.
 *
 * Original work. The format is defined by the TCK in namespace
 * `http://www.omg.org/spec/DMN/20160719/testcase`: a `testCases` document
 * naming a model, with `testCase` elements carrying `inputNode` values and
 * `resultNode` expectations.
 *
 * Values are parsed into the wire format (`wire.ts`) rather than directly into
 * FEEL values. That keeps types this runtime cannot yet evaluate — dates,
 * times, durations — intact so they can still be handed to a reference engine
 * in the differential harness. Collapsing them at parse time would have thrown
 * away exactly the cases most worth recording reference values for.
 */

import {
  attribute,
  childNamed,
  childrenNamed,
  parseXml,
  type XmlElement,
} from '@smarthorizon-labs/dmn-xml';

import type { WireValue } from './wire.js';

export interface ResultExpectation {
  readonly name: string;
  /** `decision` or `decisionService`. */
  readonly type: string;
  /** True when the TCK expects evaluation to fail. */
  readonly errorResult: boolean;
  readonly expected: WireValue;
}

/**
 * What the case invokes.
 *
 * A `testCase` may carry `type="decisionService"` with an `invocableName`,
 * meaning the service is invoked directly rather than the whole model being
 * evaluated. The distinction is not cosmetic: a service applies encapsulation,
 * so evaluating the model instead produces different — and wrong — results.
 */
export interface Invocable {
  readonly type: 'decision' | 'decisionService';
  readonly name: string;
}

export interface TestCase {
  readonly id: string;
  readonly description?: string;
  readonly invocable?: Invocable;
  readonly inputs: ReadonlyMap<string, WireValue>;
  readonly results: readonly ResultExpectation[];
}

export interface TestCaseFile {
  readonly modelName: string;
  readonly labels: readonly string[];
  readonly cases: readonly TestCase[];
}

export function parseTestCases(source: string): TestCaseFile {
  const root = parseXml(source);
  const labels = childNamed(root, 'labels');

  return {
    modelName: childNamed(root, 'modelName')?.text.trim() ?? '',
    labels:
      labels === undefined
        ? []
        : childrenNamed(labels, 'label').map((label) => label.text.trim()),
    cases: childrenNamed(root, 'testCase').map(readTestCase),
  };
}

function readTestCase(element: XmlElement): TestCase {
  const inputs = new Map<string, WireValue>();

  for (const node of childrenNamed(element, 'inputNode')) {
    inputs.set(attribute(node, 'name') ?? '', readValue(node));
  }

  const description = childNamed(element, 'description')?.text.trim();
  const invocableName = attribute(element, 'invocableName');
  const type = attribute(element, 'type');

  return {
    id: attribute(element, 'id') ?? '',
    ...(description === undefined || description === '' ? {} : { description }),
    ...(invocableName === undefined
      ? {}
      : {
          invocable: {
            type: type === 'decisionService' ? ('decisionService' as const) : ('decision' as const),
            name: invocableName,
          },
        }),
    inputs,
    results: childrenNamed(element, 'resultNode').map(readResultNode),
  };
}

function readResultNode(element: XmlElement): ResultExpectation {
  const expected = childNamed(element, 'expected');

  return {
    name: attribute(element, 'name') ?? '',
    type: attribute(element, 'type') ?? 'decision',
    errorResult: attribute(element, 'errorResult') === 'true',
    expected: expected === undefined ? { type: 'null' } : readValue(expected),
  };
}

/**
 * Reads a TCK value node.
 *
 * Three shapes occur: a scalar `value`, one or more named `component` children
 * forming a context, and a `list` of `item` children.
 */
function readValue(element: XmlElement): WireValue {
  const components = childrenNamed(element, 'component');
  if (components.length > 0) {
    const entries: Record<string, WireValue> = {};
    for (const component of components) {
      entries[attribute(component, 'name') ?? ''] = readValue(component);
    }
    return { type: 'context', entries };
  }

  const list = childNamed(element, 'list');
  if (list !== undefined) {
    return { type: 'list', items: childrenNamed(list, 'item').map(readValue) };
  }

  // An `item` or `component` may hold a nested `value`, or be a scalar itself.
  return readScalar(childNamed(element, 'value') ?? element);
}

function readScalar(element: XmlElement): WireValue {
  if (attribute(element, 'nil') === 'true') {
    return { type: 'null' };
  }

  const type = stripPrefix(attribute(element, 'type'));
  const text = element.text.trim();

  switch (type) {
    case 'string':
      // Not trimmed: leading and trailing spaces are significant in a string.
      return { type: 'string', value: element.text };

    case 'boolean':
      return { type: 'boolean', value: text === 'true' || text === '1' };

    case 'decimal':
    case 'double':
    case 'integer':
    case 'int':
    case 'long':
    case 'float':
      return { type: 'number', value: text };

    case 'date':
      return { type: 'date', value: text };

    case 'time':
      return { type: 'time', value: text };

    case 'dateTime':
      return { type: 'dateTime', value: text };

    case 'duration':
    case 'dayTimeDuration':
    case 'yearMonthDuration':
      return { type: 'duration', value: text };

    case undefined:
      return text === '' ? { type: 'null' } : { type: 'string', value: text };

    default:
      return { type: 'unsupported', detail: `xsd:${type}` };
  }
}

function stripPrefix(type: string | undefined): string | undefined {
  if (type === undefined) {
    return undefined;
  }
  const colon = type.indexOf(':');
  return colon < 0 ? type : type.slice(colon + 1);
}
