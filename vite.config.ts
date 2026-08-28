/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

// `base: './'` keeps every asset URL relative so `dist/` can be dropped into any subpath of the
// sermeatbal site (or opened from a file server) without rewriting the build.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  // The real constraint: `e2e/**` holds Playwright specs, which only `npm run e2e` can run —
  // vitest's default matcher would otherwise collect them as unit tests.
  test: { exclude: [...configDefaults.exclude, 'e2e/**'] },
});
