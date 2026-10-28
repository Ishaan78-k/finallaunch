import { Rng, hashString } from '../core/rng';
import type { Member } from '../parties/types';
import { ministerScore } from '../government/cabinet';
import type { Economy } from '../government/types';

export type CrisisId = 'floods' | 'drought' | 'fuel-shock' | 'scandal' | 'farm-protest' | 'border-tension' | 'epidemic' | 'bank-trouble' | 'strike';

export interface CrisisOption {
  label: string;
  note: string;
  /** Crore paid from the government treasury. */
  cost: number;
  approval: number;
  growth?: number;
  inflation?: number;
  unemployment?: number;
  /** Mood change for every coalition partner. */
  partner?: number;
}

export interface CrisisDef {
  id: CrisisId;
  name: string;
  text: string;
  /** The ministry whose minister can soften the blow. */
  ministry: string;
  weight: number;
  options: CrisisOption[];
  /** What happens if nobody acts for a month. */
  ignored: { approval: number; growth?: number; inflation?: number; unemployment?: number; partner?: number };
}

export const CRISES: readonly CrisisDef[] = [
  {
    id: 'floods', name: 'Floods in the east', ministry: 'home', weight: 3,
    text: 'Rivers have burst their banks. Thousands are homeless and roads are cut off.',
    options: [
      { label: 'Launch a large relief operation', note: 'Costs ₹4,000 crore. People see the state at work.', cost: 4000, approval: 4 },
      { label: 'Send a smaller relief package', note: 'Costs ₹1,500 crore.', cost: 1500, approval: 1.5 },
      { label: 'Ask the states to cope on their own', note: 'Free, but unpopular.', cost: 0, approval: -3, partner: -3 },
    ],
    ignored: { approval: -5, growth: -0.2, partner: -4 },
  },
  {
    id: 'drought', name: 'Drought in the farm belt', ministry: 'agriculture', weight: 2,
    text: 'The monsoon failed. Crops are dying and farm incomes are falling.',
    options: [
      { label: 'Loan waiver and water schemes', note: 'Costs ₹5,000 crore. Farmers breathe easier.', cost: 5000, approval: 4, inflation: -0.2 },
      { label: 'Targeted aid for the worst districts', note: 'Costs ₹1,800 crore.', cost: 1800, approval: 1.5 },
      { label: 'Do nothing', note: 'Free. Food prices will climb.', cost: 0, approval: -2, inflation: 0.6 },
    ],
    ignored: { approval: -4, inflation: 0.8, growth: -0.3 },
  },
  {
    id: 'fuel-shock', name: 'Fuel price shock', ministry: 'finance', weight: 2,
    text: 'World oil prices have jumped. Petrol and diesel are getting dearer.',
    options: [
      { label: 'Cut fuel taxes for a few months', note: 'Costs ₹3,000 crore. Eases prices.', cost: 3000, approval: 2.5, inflation: -0.4 },
      { label: 'Pass the cost on to consumers', note: 'Free, but prices rise.', cost: 0, approval: -2.5, inflation: 0.7 },
      { label: 'Release fuel reserves', note: 'Costs ₹1,200 crore. A short-term fix.', cost: 1200, approval: 0.5, inflation: -0.1 },
    ],
    ignored: { approval: -4, inflation: 0.9 },
  },
  {
    id: 'scandal', name: 'Corruption scandal', ministry: 'justice', weight: 2,
    text: 'A newspaper claims officials took bribes on a big contract. The opposition demands answers.',
    options: [
      { label: 'Order an independent inquiry', note: 'Costs ₹200 crore. Slow, but trusted.', cost: 200, approval: 2.5, partner: 2 },
      { label: 'Sack the officials at once', note: 'Free. Looks decisive.', cost: 0, approval: 1, partner: -1 },
      { label: 'Defend them and hope it passes', note: 'Free, and risky.', cost: 0, approval: -3.5, partner: -3 },
    ],
    ignored: { approval: -5, partner: -4 },
  },
  {
    id: 'farm-protest', name: 'Farmers march on the capital', ministry: 'agriculture', weight: 2,
    text: 'Lakhs of farmers have camped outside the city, demanding fair prices for their crops.',
    options: [
      { label: 'Raise support prices', note: 'Costs ₹2,500 crore. Calms the protest.', cost: 2500, approval: 3, inflation: 0.2 },
      { label: 'Open talks and offer small concessions', note: 'Costs ₹500 crore.', cost: 500, approval: 1 },
      { label: 'Hold firm', note: 'Free, but the standoff drags on.', cost: 0, approval: -3, unemployment: 0.1 },
    ],
    ignored: { approval: -4, growth: -0.2 },
  },
  {
    id: 'border-tension', name: 'Tension on the border', ministry: 'defence', weight: 1,
    text: 'Troops are facing off along a disputed border. Markets are nervous.',
    options: [
      { label: 'Move more troops and show strength', note: 'Costs ₹3,500 crore. Voters rally round.', cost: 3500, approval: 3, growth: -0.1 },
      { label: 'Quiet diplomacy through External Affairs', note: 'Costs ₹300 crore.', cost: 300, approval: 1.5 },
      { label: 'Stay silent', note: 'Free, but looks weak.', cost: 0, approval: -3, growth: -0.2 },
    ],
    ignored: { approval: -5, growth: -0.4 },
  },
  {
    id: 'epidemic', name: 'Disease outbreak', ministry: 'health', weight: 1,
    text: 'A fast-spreading illness has appeared in several cities. Hospitals are filling up.',
    options: [
      { label: 'Emergency health mission', note: 'Costs ₹4,500 crore. Saves lives and confidence.', cost: 4500, approval: 4, growth: -0.1 },
      { label: 'Advisories and local clinics', note: 'Costs ₹1,200 crore.', cost: 1200, approval: 1 },
      { label: 'Wait and watch', note: 'Free, but the outbreak spreads.', cost: 0, approval: -4, growth: -0.4, unemployment: 0.2 },
    ],
    ignored: { approval: -7, growth: -0.6, unemployment: 0.3 },
  },
  {
    id: 'bank-trouble', name: 'A big bank is in trouble', ministry: 'finance', weight: 1,
    text: 'A large bank cannot meet its loans. Savers are lining up at branches.',
    options: [
      { label: 'Bail it out', note: 'Costs ₹6,000 crore. Stops the panic.', cost: 6000, approval: 0.5, growth: 0.1 },
      { label: 'Guarantee small deposits only', note: 'Costs ₹2,000 crore.', cost: 2000, approval: 0, growth: -0.1 },
      { label: 'Let it fail', note: 'Free, but savers lose money.', cost: 0, approval: -4, growth: -0.5, unemployment: 0.3 },
    ],
    ignored: { approval: -5, growth: -0.7, unemployment: 0.4 },
  },
  {
    id: 'strike', name: 'Nationwide transport strike', ministry: 'industry', weight: 2,
    text: 'Drivers and rail workers have stopped work. Goods are piling up at ports.',
    options: [
      { label: 'Agree to pay and safety demands', note: 'Costs ₹1,800 crore. Work resumes.', cost: 1800, approval: 2, unemployment: -0.05 },
      { label: 'Mediate a middle path', note: 'Costs ₹400 crore.', cost: 400, approval: 1 },
      { label: 'Invoke emergency powers', note: 'Free, but heavy-handed.', cost: 0, approval: -2.5, partner: -2 },
    ],
    ignored: { approval: -4, growth: -0.4 },
  },
];

export const CRISIS_BY_ID: Record<CrisisId, CrisisDef> = Object.fromEntries(CRISES.map((c) => [c.id, c])) as Record<CrisisId, CrisisDef>;

export const CRISIS_WINDOW_DAYS = 30;
export const CRISIS_GAP_DAYS = 60;
export const CRISIS_CHANCE = 0.2;

export interface ActiveCrisis { id: CrisisId; startDay: number; deadline: number }
export interface CrisisRecord { id: CrisisId; day: number; /** The option chosen, or null if ignored. */ choice: number | null; approvalChange: number }

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Whether a crisis breaks out in the month ending `monthDay`. Same seed and day always gives the same answer. */
export function rollCrisis(seed: number, monthDay: number, lastCrisisDay: number): CrisisId | null {
  if (monthDay - lastCrisisDay < CRISIS_GAP_DAYS) return null;
  const rng = new Rng(seed ^ hashString(`crisis:${monthDay}`));
  if (rng.next() >= CRISIS_CHANCE) return null;
  return rng.weighted(CRISES.map((c) => ({ item: c.id, weight: c.weight })));
}

/** How the minister in charge changes the outcome. A strong minister helps, an empty chair hurts. */
export function ministerEffect(def: CrisisDef, cabinet: Record<string, string>, owners: Record<string, string>, members: Member[], playerId: string): number {
  if (owners[def.ministry] !== playerId) return 0; // a partner's minister: out of your hands
  const id = cabinet[def.ministry];
  const m = id ? members.find((x) => x.id === id && x.status === 'active') : undefined;
  if (!m) return -1;
  const score = ministerScore(m);
  return score >= 70 ? 1.5 : score >= 50 ? 0.5 : -0.5;
}

export interface CrisisEffect { approval: number; economy: Economy; partner: number }

export function applyEconomyDelta(e: Economy, d: { growth?: number; inflation?: number; unemployment?: number }): Economy {
  return {
    ...e,
    growth: round2(clamp(e.growth + (d.growth ?? 0), -4, 11)),
    inflation: round2(clamp(e.inflation + (d.inflation ?? 0), 1, 15)),
    unemployment: round2(clamp(e.unemployment + (d.unemployment ?? 0), 2, 20)),
  };
}

/** Result of leaving a crisis alone. */
export function ignoredEffect(def: CrisisDef, economy: Economy): CrisisEffect {
  return { approval: def.ignored.approval, economy: applyEconomyDelta(economy, def.ignored), partner: def.ignored.partner ?? 0 };
}

export function optionEffect(def: CrisisDef, opt: CrisisOption, economy: Economy, minister: number): CrisisEffect {
  return { approval: round1(opt.approval + minister), economy: applyEconomyDelta(economy, opt), partner: opt.partner ?? 0 };
}

export function clampApproval(a: number): number { return round1(clamp(a, 0, 100)); }
