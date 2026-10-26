/**
 * The expected-failure baseline.
 *
 * Original work. The baseline is what makes
 * running the TCK from the start useful rather than merely discouraging: without
 * it, a suite that is mostly red is noise; with it, the red is inventory.
 *
 * CI asserts the baseline **exactly**. An unexpected pass fails the build just
 * as an unexpected failure does, because a case that starts passing usually
 * means it was mis-classified, and silently absorbing that would let coverage
 * drift away from what the file claims.
 */

import type { FailureCategory, RunSummary, TestOutcome } from './runner.js';

export interface Baseline {
  /** How the file is meant to be read, for anyone opening it cold. */
  readonly $comment: string;
  readonly summary: {
    readonly total: number;
    readonly passing: number;
    readonly failing: number;
    readonly byCategory: Readonly<Record<string, number>>;
  };
  /** Test key to failure category. Sorted, so diffs are reviewable. */
  readonly expectedFailures: Readonly<Record<string, FailureCategory>>;
}

const COMMENT =
  'Expected DMN TCK failures. Each entry is a test the runtime does not yet pass, ' +
  'with the reason. Implementing a feature should REMOVE lines from this file. ' +
  'CI fails on any difference in either direction: an unexpected pass usually means ' +
  'a test was mis-classified. Regenerate with `npm run tck:update`.';

export function buildBaseline(summary: RunSummary): Baseline {
  const expectedFailures: Record<string, FailureCategory> = {};
  const byCategory: Record<string, number> = {};

  for (const outcome of [...summary.outcomes].sort((a, b) => a.key.localeCompare(b.key))) {
    if (outcome.passed) {
      continue;
    }

    const category = outcome.category ?? 'RUNTIME_ERROR';
    expectedFailures[outcome.key] = category;
    byCategory[category] = (byCategory[category] ?? 0) + 1;
  }

  return {
    $comment: COMMENT,
    summary: {
      total: summary.total,
      passing: summary.passing,
      failing: summary.failing,
      byCategory: Object.fromEntries(
        Object.entries(byCategory).sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
    expectedFailures,
  };
}

export interface BaselineDrift {
  /** Failing now, absent from the baseline: a regression, or new coverage. */
  readonly unexpectedFailures: readonly TestOutcome[];
  /** Passing now, listed in the baseline: remove these lines. */
  readonly unexpectedPasses: readonly string[];
  /** Failing for a different reason than the baseline records. */
  readonly changedCategories: readonly {
    readonly key: string;
    readonly was: FailureCategory;
    readonly now: FailureCategory;
  }[];
}

export function compareToBaseline(summary: RunSummary, baseline: Baseline): BaselineDrift {
  const expected = baseline.expectedFailures;
  const unexpectedFailures: TestOutcome[] = [];
  const changedCategories: BaselineDrift['changedCategories'][number][] = [];
  const stillFailing = new Set<string>();

  for (const outcome of summary.outcomes) {
    const recorded = expected[outcome.key];

    if (outcome.passed) {
      continue;
    }

    stillFailing.add(outcome.key);
    const category = outcome.category ?? 'RUNTIME_ERROR';

    if (recorded === undefined) {
      unexpectedFailures.push(outcome);
    } else if (recorded !== category) {
      changedCategories.push({ key: outcome.key, was: recorded, now: category });
    }
  }

  const unexpectedPasses = Object.keys(expected)
    .filter((key) => !stillFailing.has(key))
    .sort();

  return { unexpectedFailures, unexpectedPasses, changedCategories };
}

export function isClean(drift: BaselineDrift): boolean {
  return (
    drift.unexpectedFailures.length === 0 &&
    drift.unexpectedPasses.length === 0 &&
    drift.changedCategories.length === 0
  );
}
