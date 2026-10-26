/**
 * Verifies that every published package is importable through both of the
 * entry points it declares (ADR-0002).
 *
 * A conditional `exports` map is a claim about how a package resolves. This
 * script checks the claim by actually resolving it, from ESM and from
 * CommonJS, and by confirming the built artefacts exist.
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/** Packages to verify, and a named export each must expose. */
const PACKAGES = [
  { dir: 'packages/model', expect: 'indexModel' },
  { dir: 'packages/xml', expect: 'loadDmnXml' },
  { dir: 'packages/feel-adapter', expect: 'createFeelEngine', checkEngineInfo: true },
  { dir: 'packages/runtime', expect: 'compileModel' },
  // The facade re-exports three packages, so a name that collides between them
  // would be silently dropped from the barrel rather than reported. Checking
  // one symbol from each source package is what catches that.
  { dir: 'packages/dmn', expect: 'compileModel', alsoExpect: ['loadDmnXml', 'toFeelNumber', 'indexModel'] },
];

let failures = 0;

function fail(message) {
  console.error(`  FAIL  ${message}`);
  failures++;
}

for (const { dir, expect, checkEngineInfo, alsoExpect = [] } of PACKAGES) {
  const packageDir = join(root, dir);
  const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));

  console.log(`\n${manifest.name}`);

  const esm = join(packageDir, manifest.module ?? '');
  const cjs = join(packageDir, manifest.main ?? '');
  const types = join(packageDir, manifest.types ?? '');

  for (const [label, path] of [
    ['ESM build', esm],
    ['CJS build', cjs],
    ['type declarations', types],
  ]) {
    if (!existsSync(path)) {
      fail(`${label} missing at ${path} — run \`npm run build\` first`);
    }
  }

  if (failures > 0) {
    break;
  }

  const viaEsm = await import(pathToFileURL(esm).href);
  if (typeof viaEsm[expect] !== 'function') {
    fail(`ESM entry point does not export ${expect}`);
  } else {
    console.log(`  ok    ESM export ${expect}`);
  }

  const viaCjs = require(cjs);
  if (typeof viaCjs[expect] !== 'function') {
    fail(`CommonJS entry point does not export ${expect}`);
  } else {
    console.log(`  ok    CommonJS export ${expect}`);
  }

  for (const name of alsoExpect) {
    if (typeof viaEsm[name] !== 'function' || typeof viaCjs[name] !== 'function') {
      fail(`re-exported symbol ${name} is missing from at least one entry point`);
    } else {
      console.log(`  ok    re-export ${name}`);
    }
  }

  // Apache-2.0 section 4 requires the license and the NOTICE to travel with
  // redistribution. `files` can list them and they can still be absent.
  for (const legal of ['LICENSE', 'NOTICE']) {
    if (!existsSync(join(packageDir, legal))) {
      fail(`${legal} missing from ${dir} — it would ship without it`);
    }
  }

  if (!(manifest.files ?? []).includes('LICENSE')) {
    fail(`${manifest.name} does not list LICENSE in "files"`);
  }

  // The two entry points must agree, or consumers get different engines
  // depending on how they happened to import the package.
  if (checkEngineInfo && typeof viaEsm[expect] === 'function' && typeof viaCjs[expect] === 'function') {
    const esmInfo = viaEsm[expect]().info;
    const cjsInfo = viaCjs[expect]().info;

    if (JSON.stringify(esmInfo) !== JSON.stringify(cjsInfo)) {
      fail('ESM and CommonJS entry points report different engine info');
    } else if (esmInfo.numericSemantics !== 'DECIMAL128') {
      fail(`unexpected numeric semantics: ${esmInfo.numericSemantics}`);
    } else {
      console.log(`  ok    both entry points report ${esmInfo.numericSemantics}`);
    }
  }
}

// Lockstep release. The packages pin each other to exact versions and are
// only ever tested together, so a release where they disagree — a facade
// depending on the previous runtime, or an engine reporting a stale version in
// every trace — is a broken release that every other check would pass.
// `scripts/set-version.mjs` moves them together; this proves it did.
console.log('\nrelease consistency');
if (failures === 0) {
  const manifests = await Promise.all(
    PACKAGES.map(async ({ dir }) =>
      JSON.parse(await readFile(join(root, dir, 'package.json'), 'utf8')),
    ),
  );
  const version = manifests.find((m) => m.name === '@smarthorizon-labs/dmn').version;
  const published = new Set(manifests.map((m) => m.name));

  for (const manifest of manifests) {
    if (manifest.version !== version) {
      fail(`${manifest.name} is ${manifest.version}, the release is ${version}`);
    }
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (published.has(name) && range !== version) {
        fail(`${manifest.name} depends on ${name}@${range}, the release is ${version}`);
      }
    }
    // Fail-closed provenance: a publish from anywhere without an OIDC
    // identity is refused rather than going out unattested.
    if (manifest.publishConfig?.access !== 'public' || manifest.publishConfig?.provenance !== true) {
      fail(`${manifest.name} must set publishConfig { access: "public", provenance: true }`);
    }
  }

  const feel = await import(pathToFileURL(join(root, 'packages/feel-adapter/dist/index.js')).href);
  const reported = feel.createFeelEngine().info.adapterVersion;
  if (reported !== version) {
    fail(`the FEEL engine reports version ${reported}, the release is ${version}`);
  }

  if (failures === 0) {
    console.log(`  ok    ${manifests.length} packages at ${version}, pinned to each other, engine reports ${reported}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} packaging check(s) failed.`);
  process.exit(1);
}

console.log('\nPackaging verified.');
