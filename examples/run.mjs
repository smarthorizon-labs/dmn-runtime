/**
 * Runs an example model against its scenarios.
 *
 *   node examples/run.mjs                          list every example
 *   node examples/run.mjs 08-fraud-risk            run one
 *   node examples/run.mjs 08-fraud-risk --trace    ... and print its audit trace
 *   node examples/run.mjs --all                    run everything
 *
 * Requires `npm run build` first.
 */

import { describeValue } from '@smarthorizon-labs/dmn-feel';

import { loadExample, runCase, scenarios } from './harness.mjs';

function list() {
  const names = Object.keys(scenarios);
  const width = Math.max(...names.map((name) => name.length));

  console.log('Examples, in rough order of complexity:\n');

  for (const name of names) {
    const { complexity, domain, summary } = scenarios[name];
    console.log(`  ${name.padEnd(width)}  ${complexity.padEnd(12)} ${domain}`);
    console.log(`  ${' '.repeat(width)}  ${summary}\n`);
  }

  console.log('Run one with:  node examples/run.mjs <name> [--trace]');
}

function run(name, withTrace) {
  const { scenario, model, compiled } = loadExample(name);

  console.log(`\n${'='.repeat(74)}`);
  console.log(`${scenario.title}   [${scenario.complexity}]`);
  console.log('='.repeat(74));
  console.log(`Model      ${model.name} (DMN ${model.dmnVersion})`);
  console.log(
    `Structure  ${compiled.decisions.size} decision(s), ` +
      `${compiled.bkms.size} BKM(s), ${model.decisionServices.length} service(s)`,
  );
  console.log(`\n${scenario.summary}`);
  console.log(`Shows: ${scenario.teaches}\n`);

  let failures = 0;

  for (const testCase of scenario.cases) {
    console.log(`--- ${testCase.name}`);

    const traceOptions = withTrace ? { level: 'RULES', redaction: { values: 'raw' } } : undefined;
    const { result, values } = runCase(compiled, scenario, testCase, traceOptions);

    for (const [decision, expected] of Object.entries(testCase.expect)) {
      const actual = describeValue(values[decision] ?? null);
      const matched = actual === expected;
      if (!matched) failures++;

      console.log(`  ${matched ? 'ok  ' : 'FAIL'} ${decision.padEnd(24)} ${actual}`);
      if (!matched) {
        console.log(`       ${' '.repeat(24)} expected ${expected}`);
      }
    }

    if (withTrace && result.trace !== undefined) {
      for (const event of result.trace.events) {
        const rules = event.ruleIds ? ` [${event.ruleIds.join(', ')}]` : '';
        const value = event.value ? ` = ${event.value}` : '';
        console.log(
          `       ${String(event.sequence).padStart(2)}. ${event.type.padEnd(20)}` +
            `${(event.decision ?? '').padEnd(24)}${event.detail ?? ''}${rules}${value}`,
        );
      }
    }

    console.log();
  }

  return failures;
}

const args = process.argv.slice(2);
const withTrace = args.includes('--trace');
const names = args.filter((arg) => !arg.startsWith('--'));

let failures = 0;

if (args.includes('--all')) {
  for (const name of Object.keys(scenarios)) {
    failures += run(name, withTrace);
  }
} else if (names.length === 0) {
  list();
} else {
  for (const name of names) {
    failures += run(name, withTrace);
  }
}

if (failures > 0) {
  console.error(`${String(failures)} expectation(s) did not match.`);
  process.exit(1);
}
