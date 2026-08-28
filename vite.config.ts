/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// `base: './'` keeps every asset URL relative so `dist/` can be dropped into any subpath of the
// sermeatbal site (or opened from a file server) without rewriting the build.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  // `npm test` is the engine unit suite and nothing else. Without this, vitest's default matcher
  // also collects `e2e/**/*.spec.ts` — those are Playwright specs and only `npm run e2e` can run them.
  test: { include: ['tests/**/*.test.ts'] },
});
