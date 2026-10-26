/**
 * Shared loading and evaluation for the examples.
 *
 * Separate from `run.mjs` so that the test suite can import it without
 * executing the command-line interface.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileModel, evaluateDecisionService, evaluateModel } from '@smarthorizon-labs/dmn-runtime';
import { loadDmnXml } from '@smarthorizon-labs/dmn-xml';

import { scenarios } from './scenarios.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export function loadExample(name) {
  const scenario = scenarios[name];

  if (scenario === undefined) {
    throw new Error(`No example named ${JSON.stringify(name)}.`);
  }

  // A scenario may point at a model shared with another scenario, which is how
  // the same model is shown evaluated two different ways.
  const file = scenario.model ?? name;
  const source = readFileSync(resolve(here, 'models', `${file}.dmn`), 'utf8');
  const model = loadDmnXml(source);

  return { scenario, model, compiled: compileModel(model) };
}

/**
 * Runs one case.
 *
 * A scenario naming a `service` is invoked through the decision service, which
 * applies encapsulation; anything else evaluates the whole model.
 */
export function runCase(compiled, scenario, testCase, traceOptions) {
  const options = traceOptions === undefined ? {} : { trace: traceOptions };

  const result =
    scenario.service === undefined
      ? evaluateModel(compiled, testCase.inputs, options)
      : evaluateDecisionService(compiled, scenario.service, testCase.inputs, options);

  const values = {};
  for (const [name, decision] of result.decisions) {
    values[name] = decision.value;
  }

  return { result, values };
}

export { scenarios };
