/**
 * Loads the committed loan model, evaluates it, and prints the result with an
 * audit trace.
 *
 * Run from the repository root:
 *
 *   npm run build
 *   node examples/quick-start.mjs
 */

import { readFileSync } from 'node:fs';

import { toFeelNumber, describeValue } from '@smarthorizon-labs/dmn-feel';
import { compileModel, evaluateModel } from '@smarthorizon-labs/dmn-runtime';
import { loadDmnXml } from '@smarthorizon-labs/dmn-xml';

// 1. Load and compile. Compilation happens once; keep the result and reuse it.
const model = loadDmnXml(readFileSync('samples/loan-pre-qualification.dmn', 'utf8'));
const compiled = compileModel(model);

console.log(`Model: ${model.name} (DMN ${model.dmnVersion})`);
console.log(`Decisions: ${compiled.decisions.size}, BKMs: ${compiled.bkms.size}\n`);

// 2. Evaluate. Numbers are decimals — pass a string for exact monetary values.
const result = evaluateModel(
  compiled,
  {
    'Credit Score': { FICO: toFeelNumber('735') },
    'Applicant Data': {
      Monthly: {
        Income: toFeelNumber('10000'),
        Repayments: toFeelNumber('1500'),
        Expenses: toFeelNumber('500'),
        Tax: toFeelNumber('1000'),
        Insurance: toFeelNumber('200'),
      },
    },
    'Requested Product': {
      Amount: toFeelNumber('350000'),
      Rate: toFeelNumber('3.5'),
      Term: toFeelNumber('360'),
    },
  },
  {
    // 3. Ask for a trace. Values are omitted unless you opt in; here the
    //    decision outcomes are allowlisted and everything else stays out.
    trace: {
      level: 'RULES',
      correlationId: 'case-84731',
      redaction: { values: 'omit', allow: ['Loan Pre-Qualification'] },
    },
  },
);

for (const [name, decision] of result.decisions) {
  console.log(`${name.padEnd(24)} ${describeValue(decision.value)}`);
}

console.log(`\nTrace ${result.trace.traceId} (${result.trace.correlationId})`);
for (const event of result.trace.events) {
  const rules = event.ruleIds ? ` [${event.ruleIds.join(', ')}]` : '';
  const value = event.value ? ` = ${event.value}` : '';
  console.log(
    `  ${String(event.sequence).padStart(2)}. ${event.type.padEnd(20)}` +
      `${(event.decision ?? '').padEnd(24)}${event.detail ?? ''}${rules}${value}`,
  );
}
