/**
 * TCK runner entry point.
 *
 * `npm run tck`         — run and assert the baseline (what CI runs).
 * `npm run tck:update`  — regenerate the baseline after a deliberate change.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBaseline, compareToBaseline, isClean, type Baseline } from './baseline.js';
import { runTck, type TestOutcome } from './runner.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const tckRoot = process.env['DMN_TCK_ROOT'] ?? resolve(repoRoot, 'vendor/tck');
const baselinePath = resolve(repoRoot, 'packages/tck-runner/tck-baseline.json');

const update = process.argv.includes('--update');

if (!existsSync(resolve(tckRoot, 'TestCases'))) {
  console.error(`No DMN TCK checkout at ${tckRoot}.`);
  console.error('Clone it first:');
  console.error('  git clone --depth 1 https://github.com/dmn-tck/tck.git vendor/tck');
  console.error('or set DMN_TCK_ROOT to an existing checkout.');
  process.exit(2);
}

const summary = runTck({ tckRoot });

const percent =
  summary.total === 0 ? '0.00' : ((summary.passing / summary.total) * 100).toFixed(2);

console.log(
  `DMN TCK: ${String(summary.passing)}/${String(summary.total)} passing (${percent}%)`,
);

const counts = new Map<string, number>();
for (const outcome of summary.outcomes) {
  if (outcome.passed) continue;
  const category = outcome.category ?? 'RUNTIME_ERROR';
  counts.set(category, (counts.get(category) ?? 0) + 1);
}

for (const [category, count] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(5)}  ${category}`);
}

const levels = new Map<string, { passing: number; total: number }>();
for (const outcome of summary.outcomes) {
  const bucket = levels.get(outcome.level) ?? { passing: 0, total: 0 };
  bucket.total++;
  if (outcome.passed) bucket.passing++;
  levels.set(outcome.level, bucket);
}

console.log();
for (const [level, bucket] of [...levels].sort()) {
  const share = ((bucket.passing / bucket.total) * 100).toFixed(2);
  console.log(
    `  ${level}: ${String(bucket.passing)}/${String(bucket.total)} (${share}%)`,
  );
}

// `--report CATEGORY` lists the individual failures behind one bar of the
// summary. This is how the baseline is worked down: pick a category, read the
// details, implement, watch the lines disappear.
const reportIndex = process.argv.indexOf('--report');
if (reportIndex >= 0) {
  const wanted = process.argv[reportIndex + 1];
  const matching = summary.outcomes.filter(
    (outcome) => !outcome.passed && (wanted === undefined || outcome.category === wanted),
  );

  console.log(`\n${String(matching.length)} failure(s)${wanted === undefined ? '' : ` in ${wanted}`}:`);
  for (const outcome of matching) {
    console.log(`  ${outcome.key}`);
    console.log(`      ${outcome.detail ?? '(no detail)'}`);
  }
  process.exit(0);
}

if (update) {
  writeFileSync(baselinePath, `${JSON.stringify(buildBaseline(summary), null, 2)}\n`, 'utf8');
  console.log(`\nBaseline written to ${baselinePath}`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error('\nNo baseline file. Create one with `npm run tck:update`.');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
const drift = compareToBaseline(summary, baseline);

if (isClean(drift)) {
  console.log('\nBaseline matches exactly.');
  process.exit(0);
}

if (drift.unexpectedFailures.length > 0) {
  console.error(`\n${String(drift.unexpectedFailures.length)} unexpected failure(s):`);
  for (const outcome of drift.unexpectedFailures.slice(0, 25)) {
    console.error(`  ${outcome.key}`);
    console.error(`      ${outcome.category ?? 'RUNTIME_ERROR'}: ${describe(outcome)}`);
  }
  if (drift.unexpectedFailures.length > 25) {
    console.error(`  ... and ${String(drift.unexpectedFailures.length - 25)} more`);
  }
}

if (drift.unexpectedPasses.length > 0) {
  console.error(`\n${String(drift.unexpectedPasses.length)} test(s) now pass unexpectedly.`);
  console.error('If this is the intended effect of your change, run `npm run tck:update`.');
  for (const key of drift.unexpectedPasses.slice(0, 25)) {
    console.error(`  ${key}`);
  }
  if (drift.unexpectedPasses.length > 25) {
    console.error(`  ... and ${String(drift.unexpectedPasses.length - 25)} more`);
  }
}

if (drift.changedCategories.length > 0) {
  console.error(`\n${String(drift.changedCategories.length)} test(s) fail for a new reason:`);
  for (const change of drift.changedCategories.slice(0, 25)) {
    console.error(`  ${change.key}: ${change.was} -> ${change.now}`);
  }
  if (drift.changedCategories.length > 25) {
    console.error(`  ... and ${String(drift.changedCategories.length - 25)} more`);
  }
}

process.exit(1);

function describe(outcome: TestOutcome): string {
  return outcome.detail ?? '(no detail)';
}
