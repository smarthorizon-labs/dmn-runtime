import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node22',
  // ADR-0002: dual ESM/CJS. Dependencies stay external so consumers dedupe them.
  external: ['decimal.js', 'lezer-feel', '@lezer/common'],
});
