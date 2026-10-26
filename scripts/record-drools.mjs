/**
 * Runs the Drools reference tool and records what it returns.
 *
 * Drools is a JVM library, so this builds and runs it in a container rather
 * than requiring contributors to install a JDK and Maven. The recorded output
 * is committed, which is what keeps CI free of a JVM: the everyday check
 * compares against the recording, and regenerating it is a deliberate act.
 *
 * Usage: npm run diff:record
 * Requires: Docker, and `npm run diff:export` to have been run first.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolDir = resolve(repoRoot, 'tools/drools-reference');
const referenceDir = resolve(repoRoot, 'packages/tck-runner/reference');
const tckRoot = process.env.DMN_TCK_ROOT ?? resolve(repoRoot, 'vendor/tck');
const jar = resolve(toolDir, 'target/drools-reference.jar');

const MAVEN_IMAGE = 'maven:3.9-eclipse-temurin-21';
const JAVA_IMAGE = 'eclipse-temurin:21-jre';

/**
 * Builds a bind-mount argument.
 *
 * The host path is passed through untouched. These arguments go to `docker`
 * directly rather than through a shell, so a Windows drive-letter path needs no
 * rewriting — and rewriting it to `/c/...` makes Docker misread the colon as
 * the start of the mount mode.
 */
function mount(hostPath, containerPath) {
  return ['-v', `${hostPath}:/${containerPath}`];
}

function run(command, args, label) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });

  if (result.error) {
    console.error(`${label} could not start: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`${label} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(resolve(referenceDir, 'differential-cases.json'))) {
  console.error('No exported cases. Run `npm run diff:export` first.');
  process.exit(2);
}

if (!existsSync(resolve(tckRoot, 'TestCases'))) {
  console.error(`No DMN TCK checkout at ${tckRoot}. See README.md.`);
  process.exit(2);
}

mkdirSync(referenceDir, { recursive: true });

if (!existsSync(jar)) {
  run(
    'docker',
    [
      'run',
      '--rm',
      ...mount(toolDir, 'work'),
      // A named volume for the Maven cache: rebuilding should not re-download
      // 200 MB of Drools every time.
      '-v',
      'dmn-m2:/root/.m2',
      '-w',
      '/work',
      MAVEN_IMAGE,
      'mvn',
      '-q',
      '-B',
      'package',
    ],
    'building the Drools reference tool',
  );
}

run(
  'docker',
  [
    'run',
    '--rm',
    ...mount(toolDir, 'tool'),
    ...mount(tckRoot, 'tck'),
    ...mount(referenceDir, 'reference'),
    JAVA_IMAGE,
    'java',
    '-jar',
    '/tool/target/drools-reference.jar',
    '/tck/TestCases',
    '/reference/differential-cases.json',
    '/reference/drools-results.json',
  ],
  'recording Drools reference values',
);

console.log(`\nRecorded to ${resolve(referenceDir, 'drools-results.json')}`);
console.log('Review the diff before committing: it is the project\'s reference oracle.');
