/**
 * Fetches the DMN TCK at the pinned commit into `vendor/tck`.
 *
 *   npm run tck:fetch
 *
 * The baseline, the published TCK report and the recorded Drools output were
 * all produced against one TCK commit, named in
 * `packages/tck-runner/tck-version.json`. Measuring against the latest TCK
 * instead would make CI fail whenever the suite gains a test, and would make
 * the published numbers impossible to reproduce.
 *
 * Only the models and test files are checked out: the full repository is
 * around 430 MB, mostly PDFs and images. An existing checkout is moved to the
 * pinned commit rather than replaced.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pin = JSON.parse(readFileSync(join(root, 'packages/tck-runner/tck-version.json'), 'utf8'));
const target = join(root, 'vendor/tck');

function git(...args) {
  return execFileSync('git', args, { cwd: target, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

if (!existsSync(join(target, '.git'))) {
  mkdirSync(target, { recursive: true });
  git('init', '--quiet');
  git('remote', 'add', 'origin', pin.repository);
  git('config', 'core.sparseCheckout', 'true');
  git('sparse-checkout', 'set', '--no-cone', '/TestCases/**/*.dmn', '/TestCases/**/*.xml');
}

// A fresh repository has no HEAD yet; that is expected, not an error to show.
const head = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: target,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
})();

if (head === pin.commit) {
  console.log(`DMN TCK already at ${pin.commit.slice(0, 7)} (${pin.date}).`);
  process.exit(0);
}

console.log(`Fetching DMN TCK ${pin.commit.slice(0, 7)} (${pin.date})...`);
git('fetch', '--quiet', '--depth', '1', '--filter=blob:none', 'origin', pin.commit);
git('-c', 'advice.detachedHead=false', 'checkout', '--quiet', pin.commit);
console.log(`DMN TCK at ${git('rev-parse', 'HEAD').slice(0, 7)}.`);
