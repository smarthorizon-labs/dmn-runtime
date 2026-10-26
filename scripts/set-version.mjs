/**
 * Sets one version across every published package, in lockstep.
 *
 *   node scripts/set-version.mjs 0.2.0
 *
 * `npm version --workspaces` bumps each package's own `version` but is not a
 * reliable way to move the exact-version pins the packages hold on each other,
 * and it knows nothing about the version string the FEEL engine reports at
 * runtime. Getting either wrong publishes a facade that depends on the
 * previous release, or an engine that misreports itself in every trace. This
 * script moves all of them together, and `verify-packaging` fails if they
 * ever disagree.
 *
 * It edits files only. Commit, tag and release are separate, deliberate steps.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PUBLISHED = ['model', 'xml', 'feel-adapter', 'runtime', 'dmn'];
const INTERNAL = ['tck-runner'];
const SCOPE = '@smarthorizon-labs/';

const version = process.argv[2];
if (version === undefined || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('usage: node scripts/set-version.mjs <major.minor.patch[-prerelease]>');
  process.exit(2);
}

function updateManifest(dir) {
  const path = join(root, 'packages', dir, 'package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));

  manifest.version = version;
  for (const [name] of Object.entries(manifest.dependencies ?? {})) {
    if (name.startsWith(SCOPE)) {
      // Exact pins, deliberately: the packages are released together and
      // are only tested together.
      manifest.dependencies[name] = version;
    }
  }

  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`  ${manifest.name.padEnd(34)} ${version}`);
}

for (const dir of [...PUBLISHED, ...INTERNAL]) {
  updateManifest(dir);
}

// The version the FEEL engine reports in `info`, and therefore in every
// trace. A literal rather than a JSON import, so the built package does not
// carry its own manifest.
const enginePath = join(root, 'packages/feel-adapter/src/engine.ts');
const engine = readFileSync(enginePath, 'utf8');
const anchor = /adapterVersion: '[^']*'/;
if (!anchor.test(engine)) {
  console.error(`STALE ANCHOR: no \`adapterVersion: '...'\` literal in ${enginePath}`);
  process.exit(1);
}
writeFileSync(enginePath, engine.replace(anchor, `adapterVersion: '${version}'`));
console.log(`  ${'FEEL engine info.adapterVersion'.padEnd(34)} ${version}`);

console.log('\nNext: npm install (to refresh the lockfile), then npm run check.');
