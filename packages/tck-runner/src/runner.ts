/**
 * Executes the DMN TCK against the runtime.
 *
 * Original work. One *test* is one `resultNode` of one `testCase`, which is the
 * granularity the TCK reports and therefore the granularity the baseline
 * tracks.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  NOT_EVALUATED_CODES,
  describeValue,
  type FeelContext,
  type FeelValue,
} from '@smarthorizon-labs/dmn-feel';
import {
  compileModel,
  evaluateDecisionService,
  evaluateModel,
  type CompiledDmnModel,
} from '@smarthorizon-labs/dmn-runtime';
import { loadDmnXml } from '@smarthorizon-labs/dmn-xml';

import { compareValues } from './compare.js';
import { parseTestCases, type ResultExpectation, type TestCaseFile } from './testcase.js';
import { UNREPRESENTABLE, decodeWire } from './wire.js';

export type FailureCategory =
  /** The model could not be loaded at all. */
  | 'MODEL_LOAD_ERROR'
  /** The model uses a DMN construct this runtime does not evaluate yet. */
  | 'UNSUPPORTED_CONSTRUCT'
  /** The test uses a value type this runtime cannot represent yet. */
  | 'UNSUPPORTED_TYPE'
  /** The named decision does not exist in the compiled model. */
  | 'DECISION_NOT_FOUND'
  /** The runtime produced a value, and it was the wrong one. */
  | 'VALUE_MISMATCH'
  /** The TCK expected an error and evaluation succeeded. */
  | 'UNEXPECTED_SUCCESS'
  /** The runtime threw. */
  | 'RUNTIME_ERROR';

export interface TestOutcome {
  /** Stable identifier: `<level>/<case>/<file>/<testCase>/<resultNode>`. */
  readonly key: string;
  readonly level: string;
  readonly passed: boolean;
  readonly category?: FailureCategory;
  readonly detail?: string;
}

export interface RunSummary {
  readonly outcomes: readonly TestOutcome[];
  readonly total: number;
  readonly passing: number;
  readonly failing: number;
}

export interface RunOptions {
  /** Root of a DMN TCK checkout. */
  readonly tckRoot: string;
  /** Restrict the run to these compliance levels. */
  readonly levels?: readonly string[];
}

const DEFAULT_LEVELS = ['compliance-level-2', 'compliance-level-3'];

export interface DiscoveredFile {
  readonly level: string;
  readonly caseDir: string;
  readonly directory: string;
  readonly file: string;
  /** `<level>/<case>/<file>` — the stem of every test key in this file. */
  readonly prefix: string;
  /** Path to the model, relative to the TCK's `TestCases` directory. */
  readonly modelPath: string;
  readonly suite?: TestCaseFile;
  readonly error?: string;
}

/**
 * Walks a TCK checkout, yielding one entry per test file.
 *
 * Shared by the TCK runner and the differential harness, so both see exactly
 * the same set of cases.
 */
export function* discoverTestFiles(options: RunOptions): Generator<DiscoveredFile> {
  for (const level of options.levels ?? DEFAULT_LEVELS) {
    const levelDir = join(options.tckRoot, 'TestCases', level);

    if (!isDirectory(levelDir)) {
      continue;
    }

    for (const caseDir of readdirSync(levelDir).sort()) {
      const directory = join(levelDir, caseDir);
      if (!isDirectory(directory)) {
        continue;
      }

      for (const file of readdirSync(directory).sort()) {
        if (!file.endsWith('.xml')) {
          continue;
        }

        const prefix = `${level}/${caseDir}/${basename(file, '.xml')}`;

        try {
          const suite = parseTestCases(readFileSync(join(directory, file), 'utf8'));
          yield {
            level,
            caseDir,
            directory,
            file,
            prefix,
            modelPath: `${level}/${caseDir}/${suite.modelName}`,
            suite,
          };
        } catch (error) {
          yield {
            level,
            caseDir,
            directory,
            file,
            prefix,
            modelPath: '',
            error: messageOf(error),
          };
        }
      }
    }
  }
}

export function runTck(options: RunOptions): RunSummary {
  const outcomes: TestOutcome[] = [];

  for (const discovered of discoverTestFiles(options)) {
    outcomes.push(...runTestFile(discovered));
  }

  const passing = outcomes.filter((outcome) => outcome.passed).length;

  return {
    outcomes,
    total: outcomes.length,
    passing,
    failing: outcomes.length - passing,
  };
}

/** Loads and compiles the model for a discovered test file. */
export function compileFor(
  discovered: DiscoveredFile,
): { compiled: CompiledDmnModel } | { error: string } {
  try {
    const source = readFileSync(join(discovered.directory, discovered.suite?.modelName ?? ''), 'utf8');
    return { compiled: compileModel(loadDmnXml(source)) };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

/**
 * Decodes a case's inputs, reporting the first one this runtime cannot
 * represent instead of silently dropping it.
 */
export function decodeInputs(inputs: ReadonlyMap<string, WireInputs>): {
  context: FeelContext;
  unrepresentable?: string;
} {
  const context: Record<string, FeelValue> = Object.create(null) as Record<string, FeelValue>;
  let unrepresentable: string | undefined;

  for (const [name, wire] of inputs) {
    const decoded = decodeWire(wire);
    if (decoded === UNREPRESENTABLE) {
      unrepresentable ??= name;
      continue;
    }
    context[name] = decoded;
  }

  return unrepresentable === undefined
    ? { context: context as FeelContext }
    : { context: context as FeelContext, unrepresentable };
}

type WireInputs = Parameters<typeof decodeWire>[0];

function runTestFile(discovered: DiscoveredFile): readonly TestOutcome[] {
  const { level, prefix, suite } = discovered;

  if (suite === undefined) {
    return [
      {
        key: `${prefix}/-/-`,
        level,
        passed: false,
        category: 'MODEL_LOAD_ERROR',
        detail: `test file unreadable: ${discovered.error ?? 'unknown'}`,
      },
    ];
  }

  // Compile the model once for the whole file, as a host would.
  const loaded = compileFor(discovered);

  if ('error' in loaded) {
    return suite.cases.flatMap((testCase) =>
      testCase.results.map((result) => ({
        key: `${prefix}/${testCase.id}/${result.name}`,
        level,
        passed: false,
        category: 'MODEL_LOAD_ERROR' as const,
        detail: loaded.error,
      })),
    );
  }

  const outcomes: TestOutcome[] = [];

  for (const testCase of suite.cases) {
    const { context, unrepresentable } = decodeInputs(testCase.inputs);

    let evaluation;
    let runtimeError: string | undefined;

    if (unrepresentable === undefined) {
      try {
        evaluation = invoke(loaded.compiled, testCase, context);
      } catch (error) {
        runtimeError = messageOf(error);
      }
    }

    for (const result of testCase.results) {
      outcomes.push({
        key: `${prefix}/${testCase.id}/${result.name}`,
        level,
        ...judge(result, evaluation, unrepresentable, runtimeError),
      });
    }
  }

  return outcomes;
}

/**
 * Runs a case the way it asks to be run.
 *
 * A case tagged `type="decisionService"` invokes the service, which applies
 * encapsulation. Evaluating the whole model instead would supply values for
 * decisions the service treats as parameters, producing plausible but wrong
 * answers.
 */
export function invoke(
  compiled: CompiledDmnModel,
  testCase: { invocable?: { type: string; name: string } },
  context: FeelContext,
): ReturnType<typeof evaluateModel> {
  return testCase.invocable?.type === 'decisionService'
    ? evaluateDecisionService(compiled, testCase.invocable.name, context)
    : evaluateModel(compiled, context);
}

/**
 * Decides one result node.
 *
 * Exported for direct testing: the ordering inside it is load-bearing, and
 * getting it wrong once reported 49.6%% coverage for an engine evaluating a
 * fraction of that.
 */
export function judge(
  result: ResultExpectation,
  evaluation: ReturnType<typeof evaluateModel> | undefined,
  unrepresentableInput: string | undefined,
  runtimeError: string | undefined,
): Omit<TestOutcome, 'key' | 'level'> {
  if (unrepresentableInput !== undefined) {
    return {
      passed: false,
      category: 'UNSUPPORTED_TYPE',
      detail: `input ${JSON.stringify(unrepresentableInput)} uses an unsupported value type`,
    };
  }

  if (runtimeError !== undefined) {
    return { passed: false, category: 'RUNTIME_ERROR', detail: runtimeError };
  }

  if (evaluation === undefined) {
    return { passed: false, category: 'RUNTIME_ERROR', detail: 'evaluation did not run' };
  }

  const decision = evaluation.decisions.get(result.name);

  if (decision === undefined) {
    return {
      passed: false,
      category: result.type === 'decision' ? 'DECISION_NOT_FOUND' : 'UNSUPPORTED_CONSTRUCT',
      detail:
        result.type === 'decision'
          ? `no decision named ${JSON.stringify(result.name)}`
          : `${result.type} evaluation is not supported`,
    };
  }

  // Any diagnostic meaning "this was not evaluated" — an unimplemented
  // construct, an unknown built-in, a recursion cut-off. All of them yield
  // null, and none of them is evidence that null was the right answer.
  const unsupported = decision.warnings.find((warning) => NOT_EVALUATED_CODES.has(warning.code));

  if (result.errorResult) {
    // The TCK expects this decision not to produce a value, and pairs
    // `errorResult="true"` with an expected nil in 1434 of its 1438 such
    // nodes.
    //
    if (decision.failed) {
      return { passed: true };
    }

    // Order matters here. A construct we never evaluated also yields null, and
    // counting that as satisfying the expectation would turn every unimplemented
    // feature into a passing test — the suite would report ~50% while
    // evaluating almost nothing. Unsupported is checked first, always.
    if (unsupported !== undefined) {
      return { passed: false, category: 'UNSUPPORTED_CONSTRUCT', detail: unsupported.message };
    }

    // Only now: we did evaluate the expression, and it produced no value.
    // Under null propagation (ADR-0005) that is exactly what a failing decision
    // looks like — the specification says a failing decision yields null, so
    // the two are indistinguishable in the value.
    if (decision.value === null) {
      return { passed: true };
    }

    return {
      passed: false,
      category: 'UNEXPECTED_SUCCESS',
      detail: `expected no value, got ${describeValue(decision.value)}`,
    };
  }

  if (decision.failed) {
    return {
      passed: false,
      category: 'UNSUPPORTED_CONSTRUCT',
      detail: decision.messages[0] ?? 'decision failed',
    };
  }

  const expected = decodeWire(result.expected);

  if (expected === UNREPRESENTABLE) {
    return {
      passed: false,
      category: 'UNSUPPORTED_TYPE',
      detail: 'expected value uses an unsupported value type',
    };
  }

  const comparison = compareValues(decision.value, expected);

  if (comparison.equal) {
    return { passed: true };
  }

  // An unsupported construct explains the mismatch; reporting it as a wrong
  // value would misclassify missing functionality as a defect.
  return unsupported === undefined
    ? {
        passed: false,
        category: 'VALUE_MISMATCH',
        ...(comparison.detail === undefined ? {} : { detail: comparison.detail }),
      }
    : {
        passed: false,
        category: 'UNSUPPORTED_CONSTRUCT',
        detail: unsupported.message,
      };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
