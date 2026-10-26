/**
 * The README's example, executed.
 *
 * It is the first code most people will run, so it must not drift from what
 * the engine does. The model, the code and the printed output are taken
 * straight from the README — each follows a `<!-- readme-example:NAME -->`
 * marker — and checked against each other, along with the decision table the
 * README renders for readers who will not open the XML.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadDmnXml, type DecisionTable } from '@smarthorizon-labs/dmn';
import { afterAll, describe, expect, it, vi } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const README = 'README.md';
const readme = readFileSync(join(root, README), 'utf8');

/** The fenced block, or the table, that follows a marker. */
function section(name: string): string {
  const marker = `<!-- readme-example:${name} -->\n`;
  const at = readme.indexOf(marker);
  if (at < 0) throw new Error(`${README} has no "${name}" marker`);

  const rest = readme.slice(at + marker.length);
  const fenced = /^```\w*\n([\s\S]*?)\n```/.exec(rest);
  if (fenced?.[1] !== undefined) return fenced[1];

  const lines = rest.split('\n');
  const end = lines.findIndex((line) => !line.startsWith('|'));
  return lines.slice(0, end).join('\n');
}

const model = section('model');
const scratch = mkdtempSync(join(tmpdir(), 'dmn-readme-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('the README example', () => {
  it('is a DMN 1.5 model', () => {
    expect(loadDmnXml(model).dmnVersion).toBe('1.5');
  });

  it('renders the same rules the model contains', () => {
    const [, , ...rows] = section('table').split('\n');
    const rendered = rows.map((row) =>
      row
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/^`|`$/g, '')),
    );

    const decision = loadDmnXml(model).decisions.find((d) => d.name === 'Discount Rate');
    const table = decision?.expression as DecisionTable;
    const actual = table.rules.map((rule) => [...rule.inputEntries, ...rule.outputEntries]);

    expect(rendered).toEqual(actual);
  });

  it('prints exactly the documented output', async () => {
    const modelPath = join(scratch, 'discount.dmn');
    writeFileSync(modelPath, model);

    // The one change from the README text: the model's path. Everything else
    // runs as a reader would paste it.
    const code = section('code');
    expect(code.split("'discount.dmn'")).toHaveLength(2);
    const codePath = join(scratch, 'example.ts');
    writeFileSync(codePath, code.replace("'discount.dmn'", JSON.stringify(modelPath)));

    const printed: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      printed.push(args.join(' '));
    });
    try {
      await import(pathToFileURL(codePath).href);
    } finally {
      log.mockRestore();
    }

    expect(printed).toEqual(section('output').split('\n'));
  });
});
