import { Rng, hashString } from '../core/rng';
import { BILL_BY_ID, DEFAULT_SPENDING, MAX_SPEND_RATIO, TAX_LIMITS, DEFAULT_TAXES, type BillId, type GovState, type Sector, type Taxes } from '../government/types';
import { applyEconomyDelta, clampApproval } from './crises';

export type CauseId = 'jobs' | 'prices' | 'tax' | 'farm' | 'services' | 'corruption' | 'political';
export const CAUSE_IDS: readonly CauseId[] = ['jobs', 'prices', 'tax', 'farm', 'services', 'corruption', 'political'];

export type PoliceLevel = 'restraint' | 'standard' | 'heavy' | 'riot';
export interface PoliceDef { id: PoliceLevel; label: string; note: string; /** Crore from the treasury. */ cost: number; officers: number; /** 0..1 how forceful the posture is. */ force: number }
export const POLICE: readonly PoliceDef[] = [
  { id: 'restraint', label: 'Minimal presence', note: 'A few officers keep traffic moving. Free, but order depends on the crowd.', cost: 0, officers: 3, force: 0 },
  { id: 'standard', label: 'Standard deployment', note: 'Barricades and trained crowd-control officers.', cost: 60, officers: 8, force: 0.3 },
  { id: 'heavy', label: 'Heavy deployment', note: 'Riot shields and water cannon on standby.', cost: 180, officers: 12, force: 0.7 },
  { id: 'riot', label: 'Full force', note: 'Orders to clear the street. Highest risk of injuries.', cost: 350, officers: 16, force: 1 },
];
export const POLICE_BY_ID: Record<PoliceLevel, PoliceDef> = Object.fromEntries(POLICE.map((p) => [p.id, p])) as Record<PoliceLevel, PoliceDef>;

export type PromiseKind = 'unemployment-below' | 'inflation-below' | 'tax-at-most' | 'spend-at-least' | 'bill-passed' | 'approval-at-least';
export const PROMISE_KINDS: readonly PromiseKind[] = ['unemployment-below', 'inflation-below', 'tax-at-most', 'spend-at-least', 'bill-passed', 'approval-at-least'];
export interface PromiseSpec { kind: PromiseKind; /** Tax key, sector or bill id. */ key?: string; /** Change from the current value. */ delta: number; /** Days until the promise falls due. */ days: number }

export interface ProtestOption {
  label: string;
  note: string;
  /** Crore from the government treasury. */
  cost: number;
  approval: number;
  /** Change to the crowd's anger. */
  intensity: number;
  economy?: { growth?: number; inflation?: number; unemployment?: number };
  tax?: Partial<Taxes>;
  promise?: PromiseSpec;
}

export interface CauseDef { id: CauseId; name: string; banner: string; text: string; signs: string[]; options: ProtestOption[] }

export const CAUSES: readonly CauseDef[] = [
  {
    id: 'jobs', name: 'Jobs protest', banner: 'JOBS NOW!',
    text: 'Young people without work are marching on the Prime Minister\'s office, demanding jobs.',
    signs: ['WE WANT JOBS', 'WORK NOT PROMISES', 'JOBS FOR YOUTH', 'FILL VACANCIES'],
    options: [
      { label: 'Launch an emergency jobs scheme', note: 'Costs ₹2,500 crore. Unemployment eases a little.', cost: 2500, approval: 2, intensity: -45, economy: { unemployment: -0.2 } },
      { label: 'Promise unemployment will fall', note: 'Costs ₹200 crore. You must deliver within 120 days.', cost: 200, approval: 0.5, intensity: -25, promise: { kind: 'unemployment-below', delta: -0.6, days: 120 } },
      { label: 'Reject the demands', note: 'Free, but the crowd gets angrier.', cost: 0, approval: -2.5, intensity: 15 },
    ],
  },
  {
    id: 'prices', name: 'Price rise protest', banner: 'CUT PRICES!',
    text: 'Families are shouting about the price of food and fuel outside the government building.',
    signs: ['PRICES TOO HIGH', 'FOOD NOT FEES', 'RELIEF NOW', 'WE CANNOT AFFORD IT'],
    options: [
      { label: 'Subsidise essentials', note: 'Costs ₹2,200 crore. Prices ease a little.', cost: 2200, approval: 2, intensity: -45, economy: { inflation: -0.2 } },
      { label: 'Promise to bring inflation down', note: 'Costs ₹200 crore. You must deliver within 120 days.', cost: 200, approval: 0.5, intensity: -25, promise: { kind: 'inflation-below', delta: -0.8, days: 120 } },
      { label: 'Reject the demands', note: 'Free, but the crowd gets angrier.', cost: 0, approval: -2.5, intensity: 15 },
    ],
  },
  {
    id: 'tax', name: 'Tax protest', banner: 'TAX RELIEF!',
    text: 'Traders and salaried workers are demanding lower taxes.',
    signs: ['TOO MUCH TAX', 'CUT GST', 'LET US EARN', 'FAIR TAXES'],
    options: [
      { label: 'Cut income tax and GST by a point', note: 'Free now, but revenue falls.', cost: 0, approval: 2.5, intensity: -45, tax: { income: -1, gst: -1 } },
      { label: 'Promise lower GST', note: 'Costs ₹100 crore. GST must be one point lower in 150 days.', cost: 100, approval: 0.5, intensity: -25, promise: { kind: 'tax-at-most', key: 'gst', delta: -1, days: 150 } },
      { label: 'Reject the demands', note: 'Free, but the crowd gets angrier.', cost: 0, approval: -2.5, intensity: 15 },
    ],
  },
  {
    id: 'farm', name: 'Farmers\' protest', banner: 'FARMERS FIRST',
    text: 'Farmers have brought tractors and banners to the capital.',
    signs: ['FAIR CROP PRICES', 'FARMERS FEED YOU', 'WATER FOR FIELDS', 'NO MORE DEBT'],
    options: [
      { label: 'Announce a farm support package', note: 'Costs ₹1,800 crore.', cost: 1800, approval: 2, intensity: -45, economy: { inflation: 0.1 } },
      { label: 'Promise more farm spending', note: 'Costs ₹150 crore. Agriculture spending must rise within 120 days.', cost: 150, approval: 0.5, intensity: -25, promise: { kind: 'spend-at-least', key: 'agriculture', delta: 100, days: 120 } },
      { label: 'Reject the demands', note: 'Free, but the crowd gets angrier.', cost: 0, approval: -2.5, intensity: 15 },
    ],
  },
  {
    id: 'services', name: 'Public services protest', banner: 'FIX OUR SERVICES',
    text: 'Patients, parents and teachers are protesting about hospitals and schools.',
    signs: ['SAVE OUR HOSPITALS', 'SCHOOLS NEED TEACHERS', 'FUND HEALTH', 'EDUCATION NOW'],
    options: [
      { label: 'Emergency health and school funds', note: 'Costs ₹2,000 crore.', cost: 2000, approval: 2, intensity: -45 },
      { label: 'Promise higher health spending', note: 'Costs ₹150 crore. Health spending must rise within 120 days.', cost: 150, approval: 0.5, intensity: -25, promise: { kind: 'spend-at-least', key: 'health', delta: 100, days: 120 } },
      { label: 'Reject the demands', note: 'Free, but the crowd gets angrier.', cost: 0, approval: -2.5, intensity: 15 },
    ],
  },
  {
    id: 'corruption', name: 'Anti-corruption protest', banner: 'CLEAN GOVERNMENT',
    text: 'Citizens are demanding action on corruption.',
    signs: ['STOP CORRUPTION', 'WHERE IS THE MONEY', 'HONEST RULE', 'ACCOUNTABILITY'],
    options: [
      { label: 'Open an independent inquiry', note: 'Costs ₹150 crore.', cost: 150, approval: 2, intensity: -40 },
      { label: 'Promise an integrity law', note: 'Costs ₹50 crore. Pass the Public Integrity Act within 150 days.', cost: 50, approval: 0.5, intensity: -25, promise: { kind: 'bill-passed', key: 'anti-corruption', delta: 0, days: 150 } },
      { label: 'Reject the demands', note: 'Free, but the crowd gets angrier.', cost: 0, approval: -2.5, intensity: 15 },
    ],
  },
  {
    id: 'political', name: 'Anti-government rally', banner: 'LISTEN TO THE PEOPLE',
    text: 'Opponents and unhappy voters are rallying against your government.',
    signs: ['LISTEN TO US', 'PEOPLE FIRST', 'GOVERNMENT FAILED', 'WE WILL REMEMBER'],
    options: [
      { label: 'Call a national dialogue', note: 'Costs ₹100 crore.', cost: 100, approval: 1.5, intensity: -35 },
      { label: 'Promise to win back trust', note: 'Costs ₹50 crore. Approval must be five points higher within 150 days.', cost: 50, approval: 0.5, intensity: -25, promise: { kind: 'approval-at-least', delta: 5, days: 150 } },
      { label: 'Reject the demands', note: 'Free, but the crowd gets angrier.', cost: 0, approval: -2.5, intensity: 15 },
    ],
  },
];
export const CAUSE_BY_ID: Record<CauseId, CauseDef> = Object.fromEntries(CAUSES.map((c) => [c.id, c])) as Record<CauseId, CauseDef>;

/** What happens if nobody answers the crowd in time. */
export const IGNORED_OPTION: ProtestOption = { label: 'Left unanswered', note: '', cost: 0, approval: -4, intensity: 20 };

export const PROTEST_GAP_DAYS = 60;
export const PROTEST_WINDOW_DAYS = 21;
export const PROTEST_AFTERMATH_DAYS = 3;

export type ProtestOutcome = 'peaceful' | 'clash' | 'damage';
export type Reaction = 'cheer' | 'anger' | 'clash' | 'disperse';

export interface Protest {
  cause: CauseId;
  startDay: number;
  /** Day by which the government must answer. */
  deadline: number;
  /** People on the street. */
  size: number;
  /** Anger, 0..100. */
  intensity: number;
  status: 'open' | 'dispersing';
  response: number | null;
  police: PoliceLevel | null;
  outcome: ProtestOutcome | null;
  /** Day the crowd is gone, once the protest is answered. */
  endDay: number | null;
}

export interface PromiseRecord {
  id: string;
  cause: CauseId;
  kind: PromiseKind;
  key: string | null;
  target: number;
  text: string;
  madeDay: number;
  deadline: number;
  status: 'pending' | 'kept' | 'broken';
}

export interface ProtestRecord {
  cause: CauseId;
  day: number;
  size: number;
  /** The option chosen, or null if the protest was ignored. */
  choice: number | null;
  police: PoliceLevel;
  outcome: ProtestOutcome;
  injuries: number;
  arrests: number;
  approvalChange: number;
}

export interface ProtestState {
  active: Protest | null;
  lastProtestDay: number;
  /** Lingering bad feeling from protests and broken promises, 0..100. */
  unrest: number;
  /** Public trust in the police, 0..100. */
  policeTrust: number;
  promises: PromiseRecord[];
  log: ProtestRecord[];
}

export function initialProtests(day: number): ProtestState {
  return { active: null, lastProtestDay: day, unrest: 0, policeTrust: 60, promises: [], log: [] };
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const clamp01 = (n: number): number => clamp(n, 0, 1);
const round1 = (n: number): number => Math.round(n * 10) / 10;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** How angry people are about each issue, 0..1. */
export function grievances(s: GovState, day: number): Record<CauseId, number> {
  const e = s.economy;
  const ratio = (sec: Sector): number => s.spending[sec] / DEFAULT_SPENDING[sec];
  const recent = s.crisisLog.filter((c) => day - c.day <= 240);
  const badScandal = recent.some((c) => c.id === 'scandal' && (c.choice === null || c.choice === 2));
  const farmIgnored = recent.some((c) => (c.id === 'drought' || c.id === 'farm-protest') && (c.choice === null || c.choice === 2));
  const law = s.bills.some((b) => b.billId === 'anti-corruption' && b.passed);
  const broken = s.protests.promises.filter((p) => p.status === 'broken' && day - p.deadline <= 240).length;
  return {
    jobs: clamp01((e.unemployment - 5) / 8),
    prices: clamp01((e.inflation - 5) / 8),
    tax: clamp01(((s.taxes.income - DEFAULT_TAXES.income) + 1.5 * (s.taxes.gst - DEFAULT_TAXES.gst) + 0.3 * (s.taxes.corporate - DEFAULT_TAXES.corporate)) / 12),
    farm: clamp01((1 - ratio('agriculture')) * 2 + (farmIgnored ? 0.5 : 0)),
    services: clamp01((1 - Math.min(ratio('health'), ratio('education'))) * 2),
    corruption: clamp01((badScandal ? 0.7 : 0.05) - (law ? 0.3 : 0)),
    political: clamp01((50 - s.approval) / 40 + broken * 0.2),
  };
}

export interface Anger { index: number; grievances: Record<CauseId, number>; top: CauseId }

/** One number, 0..100, for how close the country is to taking to the streets. */
export function publicAnger(s: GovState, day: number): Anger {
  const g = grievances(s, day);
  const sorted = [...CAUSE_IDS].sort((a, b) => g[b] - g[a]);
  const top = g[sorted[0]];
  const mean3 = (g[sorted[0]] + g[sorted[1]] + g[sorted[2]]) / 3;
  const index = Math.round(100 * clamp01(0.6 * top + 0.4 * mean3 + s.protests.unrest / 250));
  return { index, grievances: g, top: sorted[0] };
}

export function protestChance(index: number): number {
  return index < 12 ? 0.01 : clamp(0.015 + index * 0.005, 0, 0.6);
}

/** Whether a protest breaks out in the month ending `monthDay`. The same seed and day always give the same answer. */
export function rollProtest(seed: number, monthDay: number, day: number, s: GovState): Protest | null {
  const p = s.protests;
  if (s.status !== 'governing' || p.active) return null;
  if (monthDay - p.lastProtestDay < PROTEST_GAP_DAYS) return null;
  const a = publicAnger(s, monthDay);
  const rng = new Rng(seed ^ hashString(`protest:${monthDay}`));
  if (rng.next() >= protestChance(a.index)) return null;
  const cause = rng.weighted(CAUSE_IDS.map((id) => ({ item: id, weight: a.grievances[id] ** 2 + 0.02 })));
  const g = a.grievances[cause];
  const size = Math.round(clamp(300 + g * 40000 * (0.6 + 0.8 * rng.next()) + a.index * 400, 200, 120000));
  const intensity = Math.round(clamp(20 + a.index * 0.6 + rng.int(-8, 8), 10, 95));
  return { cause, startDay: day, deadline: day + PROTEST_WINDOW_DAYS, size, intensity, status: 'open', response: null, police: null, outcome: null, endDay: null };
}

export interface PoliceResult { outcome: ProtestOutcome; injuries: number; arrests: number; approval: number; trust: number; unrest: number; /** Crore of property damage. */ damage: number }

/** How the street meets the police. Anger, crowd size, force and public trust in the police all matter. */
export function policeOutcome(seed: number, startDay: number, size: number, intensity: number, level: PoliceLevel, trust: number): PoliceResult {
  const force = POLICE_BY_ID[level].force;
  const inten = clamp01(intensity / 100);
  const sizeF = Math.min(1, size / 100000);
  const rng = new Rng(seed ^ hashString(`police:${startDay}:${level}`));
  const clash = clamp(0.03 + 0.38 * inten + 0.22 * force * (0.4 + inten) + 0.08 * sizeF + (50 - trust) / 400, 0.01, 0.9);
  const roll = rng.next();
  const extra = rng.next();
  if (roll < clash) {
    const injuries = Math.round(size * (0.0015 + 0.004 * force) * (0.5 + inten));
    const arrests = Math.round(size * (0.002 + 0.004 * force));
    return {
      outcome: 'clash', injuries, arrests,
      approval: -round1(1.5 + Math.min(5, injuries / 150) + force * 1.5),
      trust: -(8 + force * 10), unrest: Math.min(25, 12 + injuries / 100), damage: 0,
    };
  }
  if (inten > 0.6 && force < 0.3 && extra < 0.4) {
    return { outcome: 'damage', injuries: 0, arrests: Math.round(size * 0.0005), approval: -1.5, trust: -2, unrest: 4, damage: 150 };
  }
  const heavyHanded = inten < 0.35 && force >= 0.7;
  return {
    outcome: 'peaceful', injuries: 0, arrests: Math.round(size * 0.0004 * (0.5 + force)),
    approval: heavyHanded ? -1.5 : force >= 0.3 && inten >= 0.3 ? 0.3 : 0,
    trust: heavyHanded ? -4 : force === 0 ? 3 : 1, unrest: 0, damage: 0,
  };
}

function makePromise(s: GovState, cause: CauseId, spec: PromiseSpec, day: number): PromiseRecord | null {
  let target = 0;
  let text = '';
  let key: string | null = null;
  switch (spec.kind) {
    case 'unemployment-below':
      target = round1(Math.max(2.5, s.economy.unemployment + spec.delta));
      text = `Bring unemployment to ${target}% or lower`;
      break;
    case 'inflation-below':
      target = round1(Math.max(2, s.economy.inflation + spec.delta));
      text = `Bring inflation to ${target}% or lower`;
      break;
    case 'tax-at-most': {
      const k = spec.key as keyof Taxes;
      if (!(k in TAX_LIMITS)) return null;
      key = k;
      target = Math.max(TAX_LIMITS[k][0], s.taxes[k] + spec.delta);
      text = `Keep ${k === 'gst' ? 'GST' : `${k} tax`} at ${target}% or lower`;
      break;
    }
    case 'spend-at-least': {
      const k = spec.key as Sector;
      if (!(k in DEFAULT_SPENDING)) return null;
      key = k;
      target = Math.min(Math.round(DEFAULT_SPENDING[k] * MAX_SPEND_RATIO), Math.round(s.spending[k] + spec.delta));
      text = `Spend at least ₹${target} crore a month on ${k}`;
      break;
    }
    case 'bill-passed': {
      const k = spec.key as BillId;
      if (!BILL_BY_ID[k] || s.bills.some((b) => b.billId === k && b.passed)) return null;
      key = k;
      target = 1;
      text = `Pass the ${BILL_BY_ID[k].name}`;
      break;
    }
    case 'approval-at-least':
      target = Math.min(95, Math.round(s.approval + spec.delta));
      text = `Raise government approval to ${target}% or higher`;
      break;
  }
  return { id: `P${day}-${cause}`, cause, kind: spec.kind, key, target, text, madeDay: day, deadline: day + spec.days, status: 'pending' };
}

/** Whether a promise is being met right now. It only counts on the day it falls due. */
export function promiseMet(p: PromiseRecord, s: GovState): boolean {
  switch (p.kind) {
    case 'unemployment-below': return s.economy.unemployment <= p.target;
    case 'inflation-below': return s.economy.inflation <= p.target;
    case 'tax-at-most': return s.taxes[p.key as keyof Taxes] <= p.target;
    case 'spend-at-least': return s.spending[p.key as Sector] >= p.target;
    case 'bill-passed': return s.bills.some((b) => b.billId === p.key && b.passed);
    case 'approval-at-least': return s.approval >= p.target;
  }
}

export type ProtestAction = { ok: true; state: GovState; message: string; record: ProtestRecord; reaction: Reaction } | { ok: false; error: string };

function resolveProtest(s: GovState, seed: number, a: Protest, opt: ProtestOption, choice: number | null, level: PoliceLevel, day: number): Extract<ProtestAction, { ok: true }> {
  const def = CAUSE_BY_ID[a.cause];
  const pol = POLICE_BY_ID[level];
  const intensityAfter = clamp(a.intensity + opt.intensity, 0, 100);
  const res = policeOutcome(seed, a.startDay, a.size, intensityAfter, level, s.protests.policeTrust);
  const taxes: Taxes = { ...s.taxes };
  for (const k of Object.keys(opt.tax ?? {}) as (keyof Taxes)[]) taxes[k] = clamp(taxes[k] + (opt.tax?.[k] ?? 0), TAX_LIMITS[k][0], TAX_LIMITS[k][1]);
  const promise = opt.promise ? makePromise(s, a.cause, opt.promise, day) : null;
  const promises = promise ? [...s.protests.promises.filter((p) => p.id !== promise.id), promise] : s.protests.promises;
  const approvalChange = round1(opt.approval + res.approval);
  const concession = opt.intensity <= -40;
  const unrest = round1(clamp(s.protests.unrest + res.unrest + (intensityAfter >= 50 ? (intensityAfter - 50) * 0.3 : 0) - (concession ? 5 : 0), 0, 100));
  const record: ProtestRecord = { cause: a.cause, day, size: a.size, choice, police: level, outcome: res.outcome, injuries: res.injuries, arrests: res.arrests, approvalChange };
  const outcomeText = res.outcome === 'clash'
    ? `Clashes broke out: ${res.injuries.toLocaleString()} injured, ${res.arrests.toLocaleString()} arrested.`
    : res.outcome === 'damage' ? 'Some property was damaged.' : 'The crowd stayed peaceful.';
  const message = `${def.name}: ${choice === null ? 'left unanswered' : opt.label}. ${outcomeText}`;
  const next: GovState = {
    ...s,
    taxes,
    treasury: Math.max(0, s.treasury - opt.cost - pol.cost - res.damage),
    economy: applyEconomyDelta(s.economy, opt.economy ?? {}),
    approval: clampApproval(s.approval + approvalChange),
    protests: {
      ...s.protests,
      active: { ...a, status: 'dispersing', response: choice, police: level, outcome: res.outcome, intensity: intensityAfter, endDay: day + PROTEST_AFTERMATH_DAYS },
      unrest,
      policeTrust: round1(clamp(s.protests.policeTrust + res.trust, 0, 100)),
      promises: trimPromises(promises),
      log: [...s.protests.log, record].slice(-20),
    },
    history: [`Day ${day}: ${message}`, ...s.history].slice(0, 40),
  };
  const reaction: Reaction = res.outcome === 'clash' ? 'clash' : concession ? 'cheer' : opt.intensity > 0 ? 'anger' : 'disperse';
  return { ok: true, state: next, message, record, reaction };
}

function trimPromises(list: PromiseRecord[]): PromiseRecord[] {
  const done = list.filter((p) => p.status !== 'pending').slice(-12);
  return [...done, ...list.filter((p) => p.status === 'pending')];
}

/** Answer the crowd outside. Costs come from the government treasury. */
export function respondToProtest(s: GovState, seed: number, optionIdx: number, level: PoliceLevel, day: number): ProtestAction {
  if (s.status !== 'governing') return { ok: false, error: 'The government has fallen.' };
  const a = s.protests.active;
  if (!a || a.status !== 'open') return { ok: false, error: 'There is no protest waiting for your answer.' };
  const opt = CAUSE_BY_ID[a.cause].options[optionIdx];
  if (!opt) return { ok: false, error: 'That is not an option.' };
  const pol = POLICE_BY_ID[level];
  if (!pol) return { ok: false, error: 'Unknown police posture.' };
  const total = opt.cost + pol.cost;
  if (total > s.treasury) return { ok: false, error: `The treasury has ₹${Math.round(s.treasury).toLocaleString()} crore; this needs ₹${total.toLocaleString()} crore.` };
  return resolveProtest(s, seed, a, opt, optionIdx, level, day);
}

/** Moves protests and promises on to `day`: expired protests, crowds going home, promises falling due. Returns the same state object if nothing changed. */
export function settleProtests(s: GovState, seed: number, day: number): { state: GovState; events: string[] } {
  if (s.status !== 'governing') return { state: s, events: [] };
  let st = s;
  const events: string[] = [];
  const promiseEvents: string[] = [];
  const a = st.protests.active;
  if (a && a.status === 'open' && day >= a.deadline) {
    const level: PoliceLevel = st.treasury >= POLICE_BY_ID.standard.cost ? 'standard' : 'restraint';
    const r = resolveProtest(st, seed, a, IGNORED_OPTION, null, level, day);
    st = r.state;
    events.push(`The ${CAUSE_BY_ID[a.cause].name.toLowerCase()} got no answer. ${r.message.split('. ').slice(1).join('. ')}`);
  } else if (a && a.status === 'dispersing' && a.endDay !== null && day >= a.endDay) {
    st = { ...st, protests: { ...st.protests, active: null } };
  }
  if (st.protests.promises.some((p) => p.status === 'pending' && day >= p.deadline)) {
    let approval = st.approval;
    let unrest = st.protests.unrest;
    const promises = st.protests.promises.map((p) => {
      if (p.status !== 'pending' || day < p.deadline) return p;
      const kept = promiseMet(p, st);
      approval = clampApproval(approval + (kept ? 2 : -4));
      unrest = clamp(unrest + (kept ? -8 : 10), 0, 100);
      const line = kept ? `Promise kept: ${p.text}.` : `Promise broken: ${p.text}.`;
      events.push(line);
      promiseEvents.push(line);
      return { ...p, status: kept ? ('kept' as const) : ('broken' as const) };
    });
    st = { ...st, approval, protests: { ...st.protests, promises: trimPromises(promises), unrest: round1(unrest) } };
  }
  for (const e of promiseEvents) st = { ...st, history: [`Day ${day}: ${e}`, ...st.history].slice(0, 40) };
  return { state: st, events };
}

/** Bad feeling fades month by month, and trust in the police drifts back toward normal. */
export function monthlyProtests(p: ProtestState): ProtestState {
  return { ...p, unrest: round1(p.unrest * 0.85), policeTrust: round1(p.policeTrust + (55 - p.policeTrust) * 0.1) };
}

/** Points added to (or taken from) the party's popularity when voters go to the polls. */
export function electionEffect(g: GovState | null): number {
  if (!g) return 0;
  const kept = g.protests.promises.filter((p) => p.status === 'kept').length;
  const broken = g.protests.promises.filter((p) => p.status === 'broken').length;
  return round1(clamp(0.6 * Math.min(kept, 5) - 1.5 * broken - g.protests.unrest / 12, -12, 3));
}

export type Decision =
  | { kind: 'bill'; id: BillId; passed: boolean }
  | { kind: 'tax'; key: keyof Taxes; delta: number }
  | { kind: 'spend'; sector: Sector; delta: number };

interface Favour { good: BillId[]; bad: BillId[]; taxes: (keyof Taxes)[]; sectors: Sector[] }
const FAVOURS: Record<CauseId, Favour> = {
  jobs: { good: ['rural-jobs', 'infrastructure-push'], bad: ['labour-reform'], taxes: [], sectors: ['welfare', 'infrastructure'] },
  prices: { good: ['income-tax-cut'], bad: ['gst-hike'], taxes: ['gst'], sectors: [] },
  tax: { good: ['income-tax-cut'], bad: ['gst-hike'], taxes: ['income', 'corporate', 'gst'], sectors: [] },
  farm: { good: ['rural-jobs'], bad: [], taxes: [], sectors: ['agriculture'] },
  services: { good: ['rural-jobs'], bad: [], taxes: [], sectors: ['health', 'education'] },
  corruption: { good: ['anti-corruption'], bad: [], taxes: [], sectors: [] },
  political: { good: ['anti-corruption'], bad: ['gst-hike', 'labour-reform'], taxes: [], sectors: [] },
};

/** How a crowd takes a government decision made while it is outside. */
export function decisionReaction(cause: CauseId, d: Decision): { reaction: 'cheer' | 'anger' | null; intensity: number } {
  const f = FAVOURS[cause];
  if (d.kind === 'bill') {
    if (d.passed && f.good.includes(d.id)) return { reaction: 'cheer', intensity: -8 };
    if (d.passed && f.bad.includes(d.id)) return { reaction: 'anger', intensity: 10 };
    if (!d.passed && f.good.includes(d.id)) return { reaction: 'anger', intensity: 5 };
  } else if (d.kind === 'tax' && f.taxes.includes(d.key) && d.delta !== 0) {
    return d.delta < 0 ? { reaction: 'cheer', intensity: -6 } : { reaction: 'anger', intensity: 8 };
  } else if (d.kind === 'spend' && f.sectors.includes(d.sector) && d.delta !== 0) {
    return d.delta > 0 ? { reaction: 'cheer', intensity: -5 } : { reaction: 'anger', intensity: 6 };
  }
  return { reaction: null, intensity: 0 };
}

export type Mood = 'calm' | 'angry' | 'riot' | 'dispersing' | 'clash';

/** Everything the 3D scene needs to draw the crowd. Pure data, no rendering. */
export interface ProtestView {
  cause: CauseId;
  size: number;
  intensity: number;
  mood: Mood;
  /** Officers on the street. */
  police: PoliceLevel;
  signs: string[];
  banner: string;
  /** Changes whenever a different protest begins, so the scene knows to rebuild. */
  key: string;
  open: boolean;
}

export function protestView(g: GovState | null): ProtestView | null {
  return viewOf(g?.protests.active ?? null);
}

export function viewOf(a: Protest | null): ProtestView | null {
  if (!a) return null;
  const def = CAUSE_BY_ID[a.cause];
  const mood: Mood = a.status === 'dispersing' ? (a.outcome === 'clash' ? 'clash' : 'dispersing') : a.intensity < 35 ? 'calm' : a.intensity < 70 ? 'angry' : 'riot';
  return { cause: a.cause, size: a.size, intensity: a.intensity, mood, police: a.police ?? 'restraint', signs: def.signs, banner: def.banner, key: `${a.cause}:${a.startDay}`, open: a.status === 'open' };
}

/** Number of figures drawn for a crowd of `size` people, capped for the device's quality setting. */
export function crowdAgents(size: number, maxAgents: number): number {
  return Math.max(12, Math.min(maxAgents, Math.round(Math.sqrt(Math.max(0, size)) * 0.9)));
}

export function causeName(id: CauseId): string { return cap(CAUSE_BY_ID[id].name); }
