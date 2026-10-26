import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node22',
  external: ['@smarthorizon-labs/dmn-feel', '@smarthorizon-labs/dmn-model'],
});
