/**
 * Fails the build on literal control characters in tracked source.
 *
 * A separator like U+0000 or U+001F is a perfectly good cache-key delimiter,
 * but writing it *literally* into a source file makes the file "binary" to
 * grep, invisible in review, and impossible to diff meaningfully. Written as an
 * escape sequence it behaves identically and stays readable.
 *
 * Usage: node scripts/check-source-hygiene.mjs [--fix]
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const TRACKED = '*.ts *.tsx *.mjs *.js *.java *.json *.md *.yml';
const fix = process.argv.includes('--fix');

/** Tab, newline and carriage return are the only control characters allowed. */
const ALLOWED = new Set([9, 10, 13]);

const files = execSync(`git ls-files ${TRACKED}`, { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);

// A check that passes on zero inputs proves nothing. This happens in a fresh
// repository before anything is staged, since only tracked files are read.
if (files.length === 0) {
  console.error('Source hygiene: no tracked files to check. Stage them first (git add -A).');
  process.exit(1);
}

let offences = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const found = [];

  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    if (code < 32 && !ALLOWED.has(code)) {
      found.push({ index, code });
    }
  }

  if (found.length === 0) {
    continue;
  }

  if (fix) {
    let patched = '';
    let cursor = 0;

    for (const { index, code } of found) {
      patched += source.slice(cursor, index);
      patched += `\\u${code.toString(16).padStart(4, '0')}`;
      cursor = index + 1;
    }

    writeFileSync(file, patched + source.slice(cursor), 'utf8');
    console.log(`fixed  ${file} (${String(found.length)})`);
    continue;
  }

  offences += found.length;
  const line = (index) => source.slice(0, index).split('\n').length;

  for (const { index, code } of found.slice(0, 5)) {
    console.error(
      `${file}:${String(line(index))} contains a literal U+${code
        .toString(16)
        .padStart(4, '0')
        .toUpperCase()}; write it as an escape sequence instead`,
    );
  }
}

if (offences > 0) {
  console.error(`\n${String(offences)} literal control character(s). Run with --fix.`);
  process.exit(1);
}

if (!fix) {
  console.log(`Source hygiene: ${String(files.length)} files clean.`);
}
