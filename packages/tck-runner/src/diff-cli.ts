/**
 * Differential harness entry point.
 *
 * `npm run diff:export`  — write the case file for the Drools reference tool.
 * `npm run diff`         — compare this runtime against the recorded results.
 * `npm run diff -- --report ourDefects` — list one bucket in full.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compareToReference,
  exportCases,
  type Divergence,
  type ReferenceResults,
} from './differential.js';
import { describeWire } from './wire.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const tckRoot = process.env['DMN_TCK_ROOT'] ?? resolve(repoRoot, 'vendor/tck');
const referenceDir = resolve(repoRoot, 'packages/tck-runner/reference');
const casesPath = resolve(referenceDir, 'differential-cases.json');
const resultsPath = resolve(referenceDir, 'drools-results.json');

if (!existsSync(resolve(tckRoot, 'TestCases'))) {
  console.error(`No DMN TCK checkout at ${tckRoot}. See README.md.`);
  process.exit(2);
}

if (process.argv.includes('--export')) {
  mkdirSync(referenceDir, { recursive: true });
  const exported = exportCases({ tckRoot });
  writeFileSync(casesPath, `${JSON.stringify(exported, null, 1)}\n`, 'utf8');
  console.log(`Wrote ${String(exported.cases.length)} case(s) to ${casesPath}`);
  process.exit(0);
}

if (!existsSync(resultsPath)) {
  console.error(`No recorded Drools results at ${resultsPath}.`);
  console.error('Generate them with: npm run diff:export && npm run diff:record');
  process.exit(2);
}

const reference = JSON.parse(readFileSync(resultsPath, 'utf8')) as ReferenceResults;
const summary = compareToReference({ tckRoot }, reference);

const total = summary.results.length;
console.log(`Differential vs Apache KIE Drools 10.2.0 — ${String(total)} comparisons\n`);

for (const [agreement, count] of Object.entries(summary.counts).sort((a, b) => b[1] - a[1])) {
  if (count === 0) continue;
  const share = ((count / total) * 100).toFixed(1);
  console.log(`  ${String(count).padStart(5)}  ${agreement.padEnd(18)} ${share}%`);
}

console.log('\nOf the divergences, arbitrated by the TCK expectation:');
console.log(`  ${String(summary.ourDefects.length).padStart(5)}  TCK backs Drools — our defects`);
console.log(`  ${String(summary.droolsDefects.length).padStart(5)}  TCK backs us`);
console.log(`  ${String(summary.unexplained.length).padStart(5)}  TCK backs neither`);

const reportIndex = process.argv.indexOf('--report');

if (reportIndex >= 0) {
  const bucket = process.argv[reportIndex + 1] ?? 'ourDefects';
  const rows: readonly Divergence[] =
    bucket === 'droolsDefects'
      ? summary.droolsDefects
      : bucket === 'unexplained'
        ? summary.unexplained
        : bucket === 'all'
          ? summary.results.filter((row) => row.agreement === 'DIFFER')
          : summary.ourDefects;

  console.log(`\n${bucket} (${String(rows.length)}):`);
  for (const row of rows) {
    console.log(`\n  ${row.key}`);
    console.log(`      ours   ${describeWire(row.ours)}`);
    console.log(`      drools ${describeWire(row.drools)}`);
    console.log(`      tck    ${describeWire(row.tck)}`);
  }
}

// The harness reports; it does not gate. Divergence from another engine is
// evidence to be reviewed, not automatically a build failure — that is what
// the TCK baseline is for.
process.exit(0);
