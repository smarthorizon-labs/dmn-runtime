import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const root = dirname(fileURLToPath(import.meta.url));

const workspacePackage = (name: string, dir: string) =>
  [`@smarthorizon-labs/${name}`, resolve(root, `packages/${dir}/src/index.ts`)] as const;

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'examples/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
    },
  },
  resolve: {
    // Cross-package imports must resolve to source, not to `dist`. Without
    // this, a test can pass against a stale build of the package it is meant
    // to be exercising — which is worse than failing.
    alias: Object.fromEntries([
      workspacePackage('dmn-model', 'model'),
      workspacePackage('dmn-xml', 'xml'),
      workspacePackage('dmn-feel', 'feel-adapter'),
      workspacePackage('dmn-runtime', 'runtime'),
      workspacePackage('dmn', 'dmn'),
    ]),
  },
});
