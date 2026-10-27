/**
 * Generates `docs/tck-report.md` from a live TCK run.
 *
 * `tck-baseline.json` is the machine-readable record and the thing CI asserts,
 * but it is a flat map of three thousand test keys to a category — nobody
 * evaluating the engine is going to read it. This produces the human-readable
 * companion: what passes, what does not, and *why* it does not, grouped by
 * cause rather than by the category label.
 *
 * The report is generated rather than written, so it cannot drift from the
 * measurement. `npm run tck:report` refreshes it; CI regenerates it and fails
 * if the committed copy differs.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requirePinnedTck, TCK_PIN } from './pin.js';
import { runTck, type RunSummary, type TestOutcome } from './runner.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const tckRoot = process.env['DMN_TCK_ROOT'] ?? resolve(repoRoot, 'vendor/tck');
const reportPath = resolve(repoRoot, 'docs/tck-report.md');

/**
 * Themes are the roadmap, not the code. A cause is assigned to the first
 * theme whose pattern it matches; anything unmatched lands in "Other", which
 * is deliberate — a silent catch-all that absorbed new failures would let the
 * report understate what is missing.
 */
const THEMES: readonly { readonly pattern: RegExp; readonly theme: string }[] = [
  // Ordered: the exclusions are built-ins and external bindings too, so they
  // have to be recognised before the general buckets swallow them.
  { pattern: /external function binding|`(now|today)\(\)`/, theme: 'Excluded by design' },
  { pattern: /^built-in function/, theme: 'Built-in function library' },
  {
    pattern: /ForExpression|QuantifiedExpression|FilterExpression|iterator expressions|filter expressions/,
    theme: 'Iteration and filters',
  },
  { pattern: /^instance of/, theme: 'Type checking with `instance of`' },
  { pattern: /SimplePositiveUnaryTest/, theme: 'Unary-test forms' },
  { pattern: /NamedParameter/, theme: 'Named parameters in invocation' },
  { pattern: /relation expressions|context expressions/, theme: 'Boxed expression forms' },
];

/**
 * Level-2 failures whose value has been compared against recorded Drools
 * 10.2.0 output by hand and found identical to the last digit. The report only
 * makes the "not a defect" claim for these exact keys.
 */
const VERIFIED_AGAINST_DROOLS = new Set([
  'compliance-level-2/0008-LX-arithmetic/0008-LX-arithmetic-test-01/002/payment',
  'compliance-level-2/0008-LX-arithmetic/0008-LX-arithmetic-test-01/003/payment',
  'compliance-level-2/0009-invocation-arithmetic/0009-invocation-arithmetic-test-01/002/MonthlyPayment',
  'compliance-level-2/0009-invocation-arithmetic/0009-invocation-arithmetic-test-01/003/MonthlyPayment',
]);

/** Reduces a failure detail to the construct behind it, dropping specifics. */
function causeOf(outcome: TestOutcome): string {
  const detail = (outcome.detail ?? '').trim();

  const builtin = /^"(.+?)" is not a function\.?$/.exec(detail);
  if (builtin?.[1] !== undefined) return `built-in function \`${builtin[1]}()\``;

  const instanceOf = /^Unsupported FEEL construct: instance of ".+"\.?$/.exec(detail);
  if (instanceOf !== null) return 'instance of <type>';

  const construct = /^Unsupported FEEL construct: (.+?)\.?$/.exec(detail);
  if (construct?.[1] !== undefined) return construct[1];

  return detail === '' ? '(no detail)' : detail;
}

/**
 * A theme answers "what would have to be built". Only `UNSUPPORTED_CONSTRUCT`
 * has one; the other categories are not gaps in the feature set and are named
 * for what they are instead of being folded into a construct bucket.
 */
function themeOf(outcome: TestOutcome): string {
  if (outcome.category === 'VALUE_MISMATCH') return 'Produced a value, and it was wrong';
  if (outcome.category === 'UNEXPECTED_SUCCESS') return 'TCK expected an error, we produced a value';
  if (outcome.category !== 'UNSUPPORTED_CONSTRUCT') return 'Runtime error';

  const cause = causeOf(outcome);
  return THEMES.find(({ pattern }) => pattern.test(cause))?.theme ?? 'Other unsupported constructs';
}

/** `compliance-level-2/0008-LX-arithmetic/...` -> `0008-LX-arithmetic`. */
function modelOf(outcome: TestOutcome): string {
  return outcome.key.split('/')[1] ?? outcome.key;
}

function tally<T>(items: readonly T[], key: (item: T) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '0.0' : ((part / whole) * 100).toFixed(1);
}

function levelLabel(level: string): string {
  const match = /compliance-level-(\d)/.exec(level);
  return match?.[1] === undefined ? level : `Level ${match[1]}`;
}

function render(summary: RunSummary): string {
  const failures = summary.outcomes.filter((outcome) => !outcome.passed);
  const out: string[] = [];
  const w = (line = '') => out.push(line);

  w('# DMN TCK report');
  w();
  w('<!-- Generated by `npm run tck:report`. Do not edit by hand. -->');
  w();
  w('Measured against the [DMN TCK](https://github.com/dmn-tck/tck), which is the');
  w('only independent measure of DMN conformance there is. Every number here comes');
  w('from a run of the suite; nothing is estimated and nothing is excluded.');
  w();
  w(
    `Suite version: commit [\`${TCK_PIN.commit.slice(0, 7)}\`](https://github.com/dmn-tck/tck/tree/${TCK_PIN.commit}) ` +
      `of ${TCK_PIN.date}. The commit is pinned, so these numbers can be reproduced exactly; ` +
      'tests added to the TCK since are not counted until the pin moves.',
  );
  w();
  w('This is **not** a claim of a DMN conformance level. Conformance levels are');
  w('defined by the OMG specification, not by a test pass rate, and this runtime');
  w('does not claim one.');
  w();

  w('## Results');
  w();
  w('| Scope | Passing | Total | |');
  w('|---|---:|---:|---:|');

  const byLevel = new Map<string, TestOutcome[]>();
  for (const outcome of summary.outcomes) {
    const bucket = byLevel.get(outcome.level) ?? [];
    bucket.push(outcome);
    byLevel.set(outcome.level, bucket);
  }

  for (const [level, outcomes] of [...byLevel].sort()) {
    const passing = outcomes.filter((outcome) => outcome.passed).length;
    w(
      `| ${levelLabel(level)} | ${String(passing)} | ${String(outcomes.length)} | ${percent(passing, outcomes.length)}% |`,
    );
  }
  w(
    `| **Overall** | **${String(summary.passing)}** | **${String(summary.total)}** | **${percent(summary.passing, summary.total)}%** |`,
  );
  w();

  // Level 2 is the meaningful figure for a runtime that does not claim CL3, so
  // it gets named individually rather than being a percentage.
  const levelTwo = failures.filter((outcome) => outcome.level.includes('level-2'));
  w('## Compliance level 2');
  w();
  if (levelTwo.length === 0) {
    w('No failures.');
  } else {
    w(
      `${String(levelTwo.length)} failing assertion${levelTwo.length === 1 ? '' : 's'}, listed in full:`,
    );
    w();
    w('| Test | Category | Detail |');
    w('|---|---|---|');
    for (const outcome of [...levelTwo].sort((a, b) => a.key.localeCompare(b.key))) {
      const detail = (outcome.detail ?? '').replace(/\|/g, '\\|');
      w(`| \`${outcome.key.replace('compliance-level-2/', '')}\` | ${outcome.category ?? 'RUNTIME_ERROR'} | ${detail} |`);
    }
    w();
    // Only asserted for the exact set of failures it was verified against. If
    // the set changes, the claim disappears rather than silently going stale.
    if (levelTwo.every((outcome) => VERIFIED_AGAINST_DROOLS.has(outcome.key))) {
      w('**None of these is a defect in this runtime.** Every one is the same');
      w('`(1 + r/12) ** -n` payment formula, and for each the value produced here is');
      w('identical to Apache KIE Drools 10.2.0 across all 34 significant digits —');
      w('and both agree with the mathematically exact result. The TCK\'s recorded');
      w('expectation was computed at lower precision and matches neither engine.');
      w('The arithmetic is analysed in [unverified semantics](unverified-semantics.md).');
      w();
      w('They stay in the baseline as failures because they *are* failures against');
      w('the TCK as written, and inventing a category to excuse them would be');
      w('grading our own homework. Against any engine that agrees with the');
      w('reference implementation, level 2 is clean.');
    } else {
      w('See [unverified semantics](unverified-semantics.md) for the analysis of');
      w('each, and do not assume the arithmetic ones are harmless without checking.');
    }
  }
  w();

  w('## Why the remaining assertions fail');
  w();
  w('Grouped by cause rather than by category label, because the category says');
  w('what happened and the cause says what is missing.');
  w();
  w('| Theme | Assertions | Share of all failures |');
  w('|---|---:|---:|');
  for (const [theme, count] of tally(failures, themeOf)) {
    w(`| ${theme} | ${String(count)} | ${percent(count, failures.length)}% |`);
  }
  w();
  w('**Excluded by design** is not work in progress. FEEL `external` bindings name');
  w('host code for the engine to execute, which this runtime refuses to do');
  w('([SECURITY.md](../SECURITY.md)). Those assertions will never pass here,');
  w('and counting them as failures rather than quietly filtering them out is the');
  w('honest presentation.');
  w();

  w('### Missing constructs, in full');
  w();
  w('Every construct the engine declined to evaluate, and how many assertions');
  w('each one costs. This is the work list, in priority order.');
  w();
  w('| Construct | Assertions |');
  w('|---|---:|');
  const unsupported = failures.filter((outcome) => outcome.category === 'UNSUPPORTED_CONSTRUCT');
  for (const [cause, count] of tally(unsupported, causeOf)) {
    // A cause is FEEL source in places, so it can contain a table delimiter.
    const cell = (cause.startsWith('built-in') ? cause : `\`${cause}\``).replace(/\|/g, '\\|');
    w(`| ${cell} | ${String(count)} |`);
  }
  w();

  w('### By category');
  w();
  w('| Category | Assertions | Meaning |');
  w('|---|---:|---|');
  const meanings: Record<string, string> = {
    UNSUPPORTED_CONSTRUCT: 'The engine reported that it could not evaluate something, and returned null rather than a guess.',
    VALUE_MISMATCH: 'The engine produced a value and it differs from the expected one.',
    UNEXPECTED_SUCCESS: 'The TCK expected an error; the engine produced a value.',
    RUNTIME_ERROR: 'The engine threw.',
  };
  for (const [category, count] of tally(failures, (outcome) => outcome.category ?? 'RUNTIME_ERROR')) {
    w(`| \`${category}\` | ${String(count)} | ${meanings[category] ?? ''} |`);
  }
  w();

  const mismatches = failures.filter((outcome) => outcome.category === 'VALUE_MISMATCH');
  if (mismatches.length > 0) {
    w('### Value mismatches by model');
    w();
    w('A mismatch is the category worth reading first: the engine was confident and');
    w('wrong, rather than honest about a gap.');
    w();
    w('| Model | Assertions |');
    w('|---|---:|');
    for (const [model, count] of tally(mismatches, modelOf).slice(0, 20)) {
      w(`| \`${model}\` | ${String(count)} |`);
    }
    w();
  }

  w('## Reproducing this');
  w();
  w('```bash');
  w('npm run tck:fetch');
  w('```');
  w();
  w('```bash');
  w('npm run tck');
  w('```');
  w();
  w('`npm run tck` asserts the committed baseline **exactly** — an unexpected pass');
  w('fails the build just as an unexpected failure does, because a test that starts');
  w('passing usually means it was misclassified. `npm run tck -- --report <CATEGORY>`');
  w('lists the individual assertions behind any row above, and');
  w('[`tck-baseline.json`](../packages/tck-runner/tck-baseline.json) itemises every');
  w('one of them.');
  w();
  w('`npm run diff` puts this runtime, Drools 10.2.0 and the TCK expectation side by');
  w('side, so a divergence says not just *that* two engines disagree but *which one');
  w('the TCK backs* — see [differential testing](differential-testing.md).');
  w();
  w('## Submission');
  w();
  w('These results are self-measured and have not been submitted to the DMN TCK');
  w('for publication. They will be once compliance level 2 is clean and every');
  w('remaining level 3 failure has a documented cause — not before.');

  return `${out.join('\n')}\n`;
}

requirePinnedTck(tckRoot);

const report = render(runTck({ tckRoot }));
const check = process.argv.includes('--check');

if (check) {
  const committed = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : '';
  if (committed !== report) {
    console.error(`${reportPath} is out of date. Regenerate it with \`npm run tck:report\`.`);
    process.exit(1);
  }
  console.log('TCK report is up to date.');
  process.exit(0);
}

writeFileSync(reportPath, report, 'utf8');
console.log(`Wrote ${reportPath}`);
