import { Rng } from '../core/rng';
import {
  DEFAULT_SPENDING, DEFAULT_TAXES, MAX_SPEND_RATIO, MIN_SPEND_RATIO, SECTORS, TAX_LIMITS,
  type Economy, type Sector, type Taxes,
} from './types';

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

export const START_ECONOMY: Economy = { gdp: 300000, growth: 6, inflation: 5, unemployment: 7, debt: 120000 };
export const START_TREASURY = 30000;
const INTEREST_YEARLY = 0.05;

/** Money the state collects in one month, crore. */
export function monthlyRevenue(economy: Economy, taxes: Taxes): number {
  const rate = taxes.income * 0.0065 + taxes.corporate * 0.0025 + taxes.gst * 0.0035;
  return Math.round((economy.gdp / 12) * rate);
}

export function monthlySpending(spending: Record<Sector, number>): number {
  return SECTORS.reduce((s, k) => s + spending[k], 0);
}

export function monthlyInterest(economy: Economy): number {
  return Math.round((economy.debt * INTEREST_YEARLY) / 12);
}

export function validTaxes(t: Taxes): string | null {
  for (const k of Object.keys(TAX_LIMITS) as (keyof Taxes)[]) {
    const [lo, hi] = TAX_LIMITS[k];
    if (!Number.isFinite(t[k]) || t[k] < lo || t[k] > hi) return `${k} tax must be between ${lo}% and ${hi}%.`;
  }
  return null;
}

export function validSpending(sp: Record<Sector, number>): string | null {
  for (const k of SECTORS) {
    const v = sp[k];
    if (!Number.isFinite(v)) return `${k} spending is not a number.`;
    if (v < DEFAULT_SPENDING[k] * MIN_SPEND_RATIO || v > DEFAULT_SPENDING[k] * MAX_SPEND_RATIO) return `${k} spending must stay between 40% and 200% of its normal level.`;
  }
  return null;
}

export interface MonthInput {
  economy: Economy;
  treasury: number;
  taxes: Taxes;
  spending: Record<Sector, number>;
  /** 0..100 average competence of the cabinet; vacant posts count as 25. */
  cabinetQuality: number;
  /** Sum of one-off growth nudges from passed bills (percentage points, already decayed). */
  billGrowth: number;
  approval: number;
  rng: Rng;
}

export interface MonthOutput {
  economy: Economy;
  treasury: number;
  approval: number;
  revenue: number;
  spent: number;
  interest: number;
  borrowed: number;
}

const rel = (spending: Record<Sector, number>, s: Sector): number => spending[s] / DEFAULT_SPENDING[s] - 1;

/** One month of the economy. Pure: same input (including rng state) gives the same output. */
export function stepMonth(i: MonthInput): MonthOutput {
  const e = i.economy;
  const revenue = monthlyRevenue(e, i.taxes);
  const spent = monthlySpending(i.spending);
  const interest = monthlyInterest(e);
  const gap = spent + interest - revenue;
  let treasury = i.treasury - gap;
  let debt = e.debt;
  let borrowed = 0;
  if (treasury < 0) { borrowed = Math.round(-treasury); debt += borrowed; treasury = 0; }
  else if (gap < 0 && debt > 0) { // a surplus pays debt down once the cash pile exceeds a year of spending
    const extra = Math.max(0, treasury - spent * 12);
    const pay = Math.min(extra, debt);
    treasury -= pay; debt -= pay;
  }
  const deficitPct = (gap / (e.gdp / 12)) * 100; // monthly gap as % of monthly output
  const debtRatio = debt / e.gdp;

  const growthTarget =
    6
    + 2.0 * rel(i.spending, 'infrastructure') + 1.0 * rel(i.spending, 'education') + 0.8 * rel(i.spending, 'agriculture') + 0.3 * rel(i.spending, 'health')
    - 0.12 * (i.taxes.corporate - DEFAULT_TAXES.corporate) - 0.05 * (i.taxes.income - DEFAULT_TAXES.income) - 0.04 * (i.taxes.gst - DEFAULT_TAXES.gst)
    - 0.25 * Math.max(0, e.inflation - 7) - 1.5 * Math.max(0, debtRatio - 0.7)
    + ((i.cabinetQuality - 50) / 50) * 0.8
    + i.billGrowth;
  const growth = clamp(e.growth + (growthTarget - e.growth) * 0.3 + i.rng.int(-30, 30) / 100, -4, 11);

  const inflationTarget = 5 + 0.25 * Math.max(-10, Math.min(30, deficitPct)) + 0.12 * (growth - 6) + 0.1 * (i.taxes.gst - DEFAULT_TAXES.gst);
  const inflation = clamp(e.inflation + (inflationTarget - e.inflation) * 0.25 + i.rng.int(-20, 20) / 100, 1, 15);

  const unemploymentTarget = 7 - 0.5 * (growth - 6) - 0.4 * rel(i.spending, 'welfare') * 0.5;
  const unemployment = clamp(e.unemployment + (unemploymentTarget - e.unemployment) * 0.2, 2, 20);

  const gdp = Math.round(e.gdp * (1 + growth / 1200));

  // Approval drifts toward how people feel about their own situation.
  const mood =
    50 + (growth - 6) * 4 - (inflation - 5) * 4 - (unemployment - 7) * 3
    + 15 * rel(i.spending, 'health') * 0.5 + 15 * rel(i.spending, 'welfare') * 0.5 + 10 * rel(i.spending, 'education') * 0.5
    - 0.8 * (i.taxes.income - DEFAULT_TAXES.income) - 0.5 * (i.taxes.gst - DEFAULT_TAXES.gst) - 0.3 * (i.taxes.corporate - DEFAULT_TAXES.corporate);
  const approval = clamp(i.approval + (clamp(mood, 0, 100) - i.approval) * 0.12, 0, 100);

  return {
    economy: { gdp, growth: round2(growth), inflation: round2(inflation), unemployment: round2(unemployment), debt: Math.round(debt) },
    treasury: Math.round(treasury),
    approval: round1(approval),
    revenue, spent, interest, borrowed,
  };
}
