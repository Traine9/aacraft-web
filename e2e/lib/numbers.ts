/**
 * numbers.ts — read the UI's formatted numbers back as numbers.
 *
 * The page prints gold as `1,234.56g` (2 decimals) and counts as `16,742`. Specs parse those back
 * and compare to the engine oracle numerically, with a tolerance that covers the display rounding —
 * comparing formatted strings instead would make every assertion a test of `Intl.NumberFormat`.
 */
import { expect } from '@playwright/test';

/** Half a display cent, plus float slack: the most a 2-decimal render can differ from the truth. */
const GOLD_TOLERANCE = 0.005 + 1e-6;

/** `"1,234.56g"` / `"16,742"` -> number. Throws on anything that is not a rendered number. */
export function parseNumber(text: string | null): number {
  const cleaned = (text ?? '').replace(/[,g\s]/g, '');
  const n = Number(cleaned);
  if (cleaned === '' || !Number.isFinite(n)) throw new Error(`not a rendered number: ${String(text)}`);
  return n;
}

/** Assert a rendered gold amount equals `want`, allowing for the 2-decimal display rounding. */
export function expectGold(actual: number, want: number, label: string): void {
  expect(Math.abs(actual - want), `${label}: rendered ${actual}, engine says ${want}`).toBeLessThanOrEqual(
    GOLD_TOLERANCE,
  );
}
