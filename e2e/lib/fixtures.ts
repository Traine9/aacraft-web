/**
 * fixtures.ts — the suite's entry point: `import { test, expect } from '@lib/fixtures'`.
 *
 * Two fixtures only. There is no backend, so there is no auth, no DB pool and no API client to set
 * up — the erp-test machinery those things need would be cargo cult here.
 *  - `calc`  the page object, already pointed at the app.
 *  - `pageHealth` (auto) fails any test that produced a console error or an uncaught exception. The
 *    page has exactly one network dependency and no framework to swallow errors, so a clean console
 *    is a real invariant, and this catches the failures that leave the DOM looking plausible.
 */
import { test as base, expect } from '@playwright/test';
import { CalculatorPage } from '@pages/calculator-page';

export interface Fixtures {
  calc: CalculatorPage;
  pageHealth: void;
}

export const test = base.extend<Fixtures>({
  calc: async ({ page }, use) => {
    await use(new CalculatorPage(page));
  },

  pageHealth: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
      });
      page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
      await use();
      expect(problems, 'the page logged no errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
