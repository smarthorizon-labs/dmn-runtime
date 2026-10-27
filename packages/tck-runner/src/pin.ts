/**
 * The DMN TCK commit this project is measured against.
 *
 * The baseline asserts exact results, so it is only meaningful against the
 * suite it was recorded from. A checkout at any other commit is refused with
 * a message saying how to fix it, rather than producing failures that look
 * like regressions — which is what happens when the suite gains a test.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface TckPin {
  readonly repository: string;
  readonly commit: string;
  readonly date: string;
}

const pinPath = resolve(dirname(fileURLToPath(import.meta.url)), '../tck-version.json');

export const TCK_PIN: TckPin = JSON.parse(readFileSync(pinPath, 'utf8')) as TckPin;

/** Exits the process when `tckRoot` is missing or not at the pinned commit. */
export function requirePinnedTck(tckRoot: string): void {
  let head: string;
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: tckRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    console.error(`No DMN TCK checkout at ${tckRoot}. Fetch the pinned commit with:`);
    console.error('  npm run tck:fetch');
    process.exit(2);
  }

  if (head !== TCK_PIN.commit) {
    console.error(
      `The DMN TCK at ${tckRoot} is at ${head.slice(0, 7)}, but this project is measured against ` +
        `${TCK_PIN.commit.slice(0, 7)} (${TCK_PIN.date}). Move it with:`,
    );
    console.error('  npm run tck:fetch');
    console.error('To adopt a newer TCK deliberately, see "Moving the TCK pin" in CONTRIBUTING.md.');
    process.exit(2);
  }
}
