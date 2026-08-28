/**
 * playwright.config.ts — one project (`chromium`), one target: the built page served by
 * `vite preview`. There is no backend, no auth and no test data to seed, so the whole suite is a
 * single lane: every spec is read-only against a static bundle, and the only "database" is
 * `public/data.json`, which the specs read directly as their oracle (see `lib/oracle.ts`).
 *
 * DATA. `public/data.json` is generated and gitignored, and the page is useless without it — so the
 * `webServer` command generates it, right before the `npm run build` that copies `public/` into the
 * `dist/` being served. Anything later (a `globalSetup`) would come too late for that build.
 *
 * REPORTS. Everything Playwright writes lands under `e2e/reports/` (gitignored): `reports/html`
 * for the HTML report, `reports/test-results` for traces and failure screenshots.
 */
import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The app repo root — this suite lives inside it and drives it through `npm run build/preview`. */
const ROOT = resolve(HERE, '..');

const PORT = Number(process.env['E2E_PORT'] ?? 4173);
// `localhost`, not `127.0.0.1`: `vite preview` binds the loopback interface as `[::1]` only, so an
// IPv4-literal base URL cannot reach it (the webServer health check just times out).
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
  ],
  outputDir: 'reports/test-results',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      // Desktop-first two-panel layout: give it room so the tree and the buy list are both on screen.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `npm run data && npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    cwd: ROOT,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
