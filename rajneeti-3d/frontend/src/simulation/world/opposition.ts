import { MAJORITY_SEATS } from '../../data/constants';
import { Rng, hashString } from '../core/rng';
import type { Ideology } from '../parties/types';
import { spendFunds } from '../parties/finance';
import { confidenceVote } from '../government/parliament';
import type { Government } from '../election/types';

export type OppositionActionId = 'press' | 'protest' | 'expose' | 'grassroots';

export interface OppositionAction {
  id: OppositionActionId;
  name: string;
  text: string;
  /** Party funds, crore. */
  cost: number;
  cooldown: number;
}

export const OPPOSITION_ACTIONS: readonly OppositionAction[] = [
  { id: 'press', name: 'Press conference', text: 'Attack the government\'s record. Cheap and safe.', cost: 0.5, cooldown: 15 },
  { id: 'protest', name: 'Protest march', text: 'Take to the streets. It can backfire.', cost: 2, cooldown: 30 },
  { id: 'expose', name: 'Expose a scandal', text: 'Release a dossier on the ruling side. Big win or big flop.', cost: 1, cooldown: 45 },
  { id: 'grassroots', name: 'Grassroots drive', text: 'Send workers door to door. Builds your own popularity.', cost: 3, cooldown: 30 },
];

export const OPPOSITION_BY_ID: Record<OppositionActionId, OppositionAction> = Object.fromEntries(OPPOSITION_ACTIONS.map((a) => [a.id, a])) as Record<OppositionActionId, OppositionAction>;

export const NO_CONFIDENCE_APPROVAL = 40;
export const NO_CONFIDENCE_COOLDOWN = 60;
export const MONTH_DAYS = 30;

export interface OppositionState {
  startDay: number;
  lastMonthDay: number;
  /** How much the public approves of the ruling government, 0..100. */
  rulingApproval: number;
  /** How well the player is seen as an opposition, 0..100. */
  standing: number;
  lastUsed: Partial<Record<OppositionActionId, number>>;
  /** Day of the last no-confidence motion. */
  motionDay: number | null;
  /** True once a motion has brought the government down. */
  rulingFallen: boolean;
  history: string[];
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const round1 = (n: number): number => Math.round(n * 10) / 10;
const note = (s: OppositionState, day: number, text: string): OppositionState => ({ ...s, history: [`Day ${day}: ${text}`, ...s.history].slice(0, 30) });

export function startOpposition(day: number): OppositionState {
  return { startDay: day, lastMonthDay: day, rulingApproval: 58, standing: 50, lastUsed: {}, motionDay: null, rulingFallen: false, history: [`Day ${day}: You lead the opposition.`] };
}

export function actionReady(s: OppositionState, id: OppositionActionId, day: number): number {
  const last = s.lastUsed[id];
  if (last === undefined) return 0;
  return Math.max(0, Math.ceil(OPPOSITION_BY_ID[id].cooldown - (day - last)));
}

export type OppAction =
  | { ok: true; state: OppositionState; funds: number; popularityDelta: number; message: string }
  | { ok: false; error: string };

/** Uses one of the opposition tools. Outcomes are fixed by seed, action and day, so reloading cannot reroll them. */
export function takeOppositionAction(s: OppositionState, funds: number, seed: number, id: OppositionActionId, day: number): OppAction {
  const a = OPPOSITION_BY_ID[id];
  if (!a) return { ok: false, error: 'Unknown action.' };
  if (s.rulingFallen) return { ok: false, error: 'The government has already fallen. Call the election.' };
  const wait = actionReady(s, id, day);
  if (wait > 0) return { ok: false, error: `${a.name} can be used again in ${wait} days.` };
  const paid = spendFunds(funds, a.cost);
  if (!paid.ok) return paid;
  const rng = new Rng(seed ^ hashString(`opp:${id}:${day}`));
  let ruling = 0; let standing = 0; let pop = 0; let text = '';
  if (id === 'press') { ruling = -0.8; standing = 0.8; pop = 0.3; text = 'Your press conference landed some blows.'; }
  else if (id === 'grassroots') { standing = 1; pop = 1.5; text = 'Workers reached thousands of homes.'; }
  else if (id === 'protest') {
    if (rng.next() < 0.65) { ruling = -2.5; standing = 2; pop = 0.8; text = 'The march drew big crowds and headlines.'; }
    else { ruling = 0.5; standing = -2; pop = -0.5; text = 'The march turned messy and the public blamed you.'; }
  } else {
    if (rng.next() < 0.45) { ruling = -4; standing = 3; pop = 1; text = 'Your dossier hit home. The ruling side is on the back foot.'; }
    else { standing = -3; pop = -1; text = 'The claims fell apart under questioning. It hurt your credibility.'; }
  }
  const next = note({
    ...s,
    rulingApproval: round1(clamp(s.rulingApproval + ruling, 0, 100)),
    standing: round1(clamp(s.standing + standing, 0, 100)),
    lastUsed: { ...s.lastUsed, [id]: day },
  }, day, `${a.name}: ${text}`);
  return { ok: true, state: next, funds: paid.funds, popularityDelta: pop, message: `${a.name}: ${text}` };
}

export interface OppositionContext {
  seed: number;
  government: Government;
  seats: Record<string, number>;
  ideologies: Record<string, Ideology>;
}

export interface OppMonthReport { day: number; events: string[] }

/** Months pass: the ruling party's approval wanders, and standing fades back towards the middle. */
export function advanceOpposition(s: OppositionState, seed: number, day: number): { state: OppositionState; reports: OppMonthReport[] } {
  let state = s;
  const reports: OppMonthReport[] = [];
  let guard = 0;
  while (state.lastMonthDay + MONTH_DAYS <= day && guard++ < 200) {
    const monthDay = state.lastMonthDay + MONTH_DAYS;
    const rng = new Rng(seed ^ hashString(`oppmonth:${monthDay}`));
    const events: string[] = [];
    let ruling = state.rulingApproval + (46 - state.rulingApproval) * 0.08 + rng.int(-25, 25) / 10;
    if (rng.next() < 0.12) {
      const good = rng.next() < 0.45;
      const swing = rng.int(3, 7);
      ruling += good ? swing : -swing;
      events.push(good ? 'The ruling party scored a popular win.' : 'The ruling party was hit by a controversy.');
    }
    state = {
      ...state, lastMonthDay: monthDay,
      rulingApproval: round1(clamp(ruling, 5, 95)),
      standing: round1(state.standing + (50 - state.standing) * 0.05),
    };
    for (const e of events) state = note(state, monthDay, e);
    reports.push({ day: monthDay, events });
  }
  return { state, reports };
}

/** Where the party's popularity is heading while in opposition. */
export function popularityTarget(s: OppositionState): number {
  return clamp(30 + (s.standing - 50) * 0.4 + (50 - s.rulingApproval) * 0.5, 10, 65);
}

export interface MotionOutcome { state: OppositionState; passed: boolean; support: number; message: string }

/** The government's support if a motion of no confidence is put to the House. */
export function governmentSupport(ctx: OppositionContext, rulingApproval: number, day: number): { support: number; own: number } {
  const parties = [ctx.government.leaderId, ...ctx.government.partners];
  const own = parties.reduce((n, p) => n + (ctx.seats[p] ?? 0), 0);
  // Unpopular governments lose MPs to rebellion.
  const rebels = Math.round(own * clamp((35 - rulingApproval) / 100, 0, 0.3));
  let outside = 0;
  if (own - rebels < MAJORITY_SEATS) {
    outside = confidenceVote({ seed: ctx.seed, day, seats: ctx.seats, ideologies: ctx.ideologies, leaderId: ctx.government.leaderId, govParties: parties, approval: rulingApproval }).outside;
  }
  return { support: own - rebels + outside, own };
}

export type MotionResult = { ok: true; outcome: MotionOutcome } | { ok: false; error: string };

export function moveNoConfidence(s: OppositionState, ctx: OppositionContext, day: number): MotionResult {
  if (s.rulingFallen) return { ok: false, error: 'The government has already fallen.' };
  if (s.motionDay !== null && day - s.motionDay < NO_CONFIDENCE_COOLDOWN) return { ok: false, error: `You can move another motion in ${NO_CONFIDENCE_COOLDOWN - (day - s.motionDay)} days.` };
  if (s.rulingApproval >= NO_CONFIDENCE_APPROVAL) return { ok: false, error: `Ruling approval is ${s.rulingApproval}%. A motion only makes sense below ${NO_CONFIDENCE_APPROVAL}%.` };
  const { support } = governmentSupport(ctx, s.rulingApproval, day);
  const passed = support < MAJORITY_SEATS;
  if (passed) {
    const msg = `The no-confidence motion passed. The government kept only ${support} votes and has fallen.`;
    return { ok: true, outcome: { state: note({ ...s, motionDay: day, rulingFallen: true, standing: round1(clamp(s.standing + 8, 0, 100)) }, day, msg), passed, support, message: msg } };
  }
  const msg = `The no-confidence motion failed. The government held ${support} votes (it needs ${MAJORITY_SEATS}).`;
  return { ok: true, outcome: { state: note({ ...s, motionDay: day, standing: round1(clamp(s.standing - 5, 0, 100)) }, day, msg), passed, support, message: msg } };
}
