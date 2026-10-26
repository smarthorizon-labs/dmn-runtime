import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DmnLoadError, detectDmnVersion, loadDmnXml } from '../src/dmn.js';
import { XmlSecurityError, parseXml } from '../src/secure-xml.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sample = readFileSync(resolve(repoRoot, 'samples/loan-pre-qualification.dmn'), 'utf8');

describe('version detection', () => {
  it('recognizes every supported DMN namespace', () => {
    expect(detectDmnVersion('http://www.omg.org/spec/DMN/20151101/dmn.xsd')).toBe('1.1');
    expect(detectDmnVersion('http://www.omg.org/spec/DMN/20180521/MODEL/')).toBe('1.2');
    expect(detectDmnVersion('https://www.omg.org/spec/DMN/20191111/MODEL/')).toBe('1.3');
    expect(detectDmnVersion('https://www.omg.org/spec/DMN/20211108/MODEL/')).toBe('1.4');
    expect(detectDmnVersion('https://www.omg.org/spec/DMN/20230324/MODEL/')).toBe('1.5');
  });

  it('ignores scheme and trailing slash differences', () => {
    // Exporters are inconsistent about http vs https on the same namespace.
    expect(detectDmnVersion('http://www.omg.org/spec/DMN/20230324/MODEL')).toBe('1.5');
  });

  it('rejects an unrecognized namespace rather than guessing', () => {
    expect(() => loadDmnXml('<definitions xmlns="urn:something-else"/>')).toThrow(DmnLoadError);
  });
});

describe('loading the DMN 1.2 sample', () => {
  const model = loadDmnXml(sample);

  it('detects the version from the namespace', () => {
    expect(model.dmnVersion).toBe('1.2');
    expect(model.name).toBe('loan_pre_qualification');
  });

  it('normalizes the DRG elements', () => {
    expect(model.inputData.map((input) => input.name).sort()).toEqual([
      'Applicant Data',
      'Credit Score',
      'Requested Product',
    ]);
    expect(model.decisions).toHaveLength(4);
    expect(model.businessKnowledgeModels).toHaveLength(4);
  });

  it('reads item definitions, including nested components and allowed values', () => {
    const applicant = model.itemDefinitions.find((item) => item.name === 'Applicant_Data');
    expect(applicant?.components.map((component) => component.name)).toContain('Monthly');

    const monthly = applicant?.components.find((component) => component.name === 'Monthly');
    expect(monthly?.components.map((component) => component.name)).toContain('Income');

    const marital = model.itemDefinitions.find((item) => item.name === 'Marital_Status');
    expect(marital?.allowedValues).toBe('"M","D","S"');
  });

  it('reads a decision table with its hit policy and rules', () => {
    const rating = model.decisions.find((decision) => decision.name === 'Credit Score Rating');
    const table = rating?.expression;

    expect(table?.kind).toBe('decisionTable');
    if (table?.kind !== 'decisionTable') return;

    expect(table.hitPolicy).toBe('UNIQUE');
    expect(table.inputs[0]?.expression).toBe('Credit Score.FICO');
    expect(table.rules).toHaveLength(5);
    expect(table.rules[0]?.inputEntries).toEqual(['>= 750']);
    expect(table.rules[0]?.outputEntries).toEqual(['"Excellent"']);
  });

  it('materializes the default hit policy rather than leaving it undefined', () => {
    // `hitPolicy` is optional in the XML and defaults to UNIQUE.
    const model12 = loadDmnXml(
      `<definitions xmlns="http://www.omg.org/spec/DMN/20180521/MODEL/" namespace="x">
         <decision name="d"><decisionTable><output/></decisionTable></decision>
       </definitions>`,
    );
    const table = model12.decisions[0]?.expression;
    expect(table?.kind === 'decisionTable' && table.hitPolicy).toBe('UNIQUE');
  });

  it('resolves information requirements to element ids', () => {
    const rating = model.decisions.find((decision) => decision.name === 'Credit Score Rating');
    expect(rating?.requirements.requiredInputs[0]?.id).toBe(
      '_4C89E59C-FDDA-438C-8D1F-0B1194EF6DAE',
    );
  });

  it('preserves source positions for diagnostics', () => {
    expect(model.decisions[0]?.location?.line).toBeGreaterThan(1);
  });
});

describe('XML security policy', () => {
  it('rejects document type declarations', () => {
    // Rejecting the DTD removes entity expansion, external
    // entity resolution and billion-laughs in one policy.
    const withDoctype = `<?xml version="1.0"?>
<!DOCTYPE definitions [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<definitions xmlns="https://www.omg.org/spec/DMN/20230324/MODEL/"/>`;

    expect(() => parseXml(withDoctype)).toThrow(XmlSecurityError);
  });

  it('enforces a document size limit', () => {
    expect(() => parseXml('<a/>', { maxLength: 2, maxDepth: 10 })).toThrow(
      /exceeds the maximum size/u,
    );
  });

  it('enforces a maximum nesting depth', () => {
    const deep = `${'<a>'.repeat(60)}${'</a>'.repeat(60)}`;
    expect(() => parseXml(deep, { maxLength: 1000, maxDepth: 10 })).toThrow(
      /nests deeper than/u,
    );
  });

  it('does not let attribute names reach Object.prototype', () => {
    const element = parseXml('<a __proto__="polluted" id="safe"/>');
    expect(element.attributes['id']).toBe('safe');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});
