import { Rng, hashString } from '../core/rng';
import type { Member, Ideology } from '../parties/types';
import { PLAYER_ID, type ElectionResult, type Government } from '../election/types';
import { compatibility } from '../election/coalition';
import { apportion } from '../election/model';
import { MINISTRIES } from '../../data/constants';
import { MINISTRY_DEFS } from './types';
import { CRISIS_BY_ID, CRISIS_WINDOW_DAYS, clampApproval, ignoredEffect, ministerEffect, optionEffect, rollCrisis } from '../world/crises';
import { initialProtests, monthlyProtests, rollProtest, settleProtests, CAUSE_BY_ID as PROTEST_CAUSES } from '../world/protests';
import { cabinetQuality, ministryOwners, pruneCabinet } from './cabinet';
import { START_ECONOMY, START_TREASURY, stepMonth, validSpending, validTaxes } from './economy';
import { confidenceVote, voteOnBill, type VoteResult } from './parliament';
import {
  BILL_BY_ID, BILL_COOLDOWN_DAYS, DEFAULT_SPENDING, DEFAULT_TAXES, MAX_SPEND_RATIO, MIN_SPEND_RATIO, MONTH_DAYS, SECTORS, TAX_LIMITS,
  type BillId, type GovState, type Sector, type Taxes,
} from './types';

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const round1 = (n: number): number => Math.round(n * 10) / 10;

export interface GovContext {
  seed: number;
  government: Government;
  result: ElectionResult;
  ideologies: Record<string, Ideology>;
  members: Member[];
}

const note = (s: GovState, day: number, text: string): GovState => ({ ...s, history: [`Day ${day}: ${text}`, ...s.history].slice(0, 40) });

/** A player-led or junior-partner coalition office can be run. */
export function canRun(g: Government | null): g is Government {
  return !!g && (g.playerRole === 'leader' || g.playerRole === 'partner');
}

export function startGovernment(gov: Government, day: number, popularity: number): GovState {
  const satisfaction: Record<string, number> = {};
  for (const p of gov.partners) satisfaction[p] = 60;
  const ministryMetrics = Object.fromEntries(MINISTRY_DEFS.map((m) => [m.id, { performance: 55, budget: m.sector ? DEFAULT_SPENDING[m.sector] : 500, complaints: 0, ministerSatisfaction: 60 }])) as GovState['ministryMetrics'];
  return {
    startDay: day, lastMonthDay: day, treasury: START_TREASURY,
    taxes: { ...DEFAULT_TAXES }, spending: { ...DEFAULT_SPENDING },
    economy: { ...START_ECONOMY }, cabinet: {}, satisfaction, partners: [...gov.partners],
    approval: clamp(popularity + 15, 40, 70), bills: [], status: 'governing', fallenReason: null,
    history: [`Day ${day}: Your government took office.`],
    crisis: null, lastCrisisDay: day, crisisLog: [], protests: initialProtests(day), switchingRequests: [], meetings: [], ministryMetrics, ministryRemoved: [],
  };
}

/** Seats of the parties currently backing the government, leader first. */
export function govParties(s: GovState, g: Government): string[] { return [g.leaderId, ...s.partners]; }
export function govSeats(s: GovState, ctx: GovContext): number {
  return govParties(s, ctx.government).reduce((n, p) => n + (ctx.result.seats[p] ?? 0), 0);
}

/** Growth nudges from past bills fade over a year. */
export function billGrowth(s: GovState, day: number): number {
  let total = 0;
  for (const b of s.bills) {
    if (!b.passed) continue;
    const g = BILL_BY_ID[b.billId].growth ?? 0;
    const age = day - b.day;
    if (age < 0 || age >= 360) continue;
    total += g * (1 - age / 360);
  }
  return total;
}

export type Action = { ok: true; state: GovState; message: string } | { ok: false; error: string };

export function setTaxes(s: GovState, taxes: Taxes): Action {
  if (s.status !== 'governing') return { ok: false, error: 'The government has fallen.' };
  const err = validTaxes(taxes);
  if (err) return { ok: false, error: err };
  return { ok: true, state: { ...s, taxes: { ...taxes } }, message: 'Tax rates updated.' };
}

export function setSpending(s: GovState, sector: Sector, amount: number): Action {
  if (s.status !== 'governing') return { ok: false, error: 'The government has fallen.' };
  const next = { ...s.spending, [sector]: Math.round(amount) };
  const err = validSpending(next);
  if (err) return { ok: false, error: err };
  return { ok: true, state: { ...s, spending: next }, message: 'Budget updated.' };
}

export function canPropose(s: GovState, billId: BillId, day: number): string | null {
  if (s.status !== 'governing') return 'The government has fallen.';
  if (!BILL_BY_ID[billId]) return 'Unknown bill.';
  if (s.bills.some((b) => b.billId === billId && b.passed)) return 'That bill is already law.';
  const last = s.bills.filter((b) => b.billId === billId).reduce((m, b) => Math.max(m, b.day), -Infinity);
  if (day - last < BILL_COOLDOWN_DAYS) return `That bill failed recently. Try again in ${Math.ceil(BILL_COOLDOWN_DAYS - (day - last))} days.`;
  return null;
}

export interface ProposeOutcome { state: GovState; vote: VoteResult; passed: boolean; message: string }

export function proposeBill(s: GovState, ctx: GovContext, billId: BillId, day: number): { ok: true; outcome: ProposeOutcome } | { ok: false; error: string } {
  const err = canPropose(s, billId, day);
  if (err) return { ok: false, error: err };
  const bill = BILL_BY_ID[billId];
  const vote = voteOnBill({
    seed: ctx.seed, day, bill, seats: ctx.result.seats, ideologies: ctx.ideologies,
    leaderId: ctx.government.leaderId, govParties: govParties(s, ctx.government), satisfaction: s.satisfaction,
  });
  let next: GovState = { ...s, bills: [...s.bills, { billId, day, passed: vote.passed, yes: vote.yes, no: vote.no, abstain: vote.abstain }] };
  if (!vote.passed) {
    next = { ...next, approval: round1(clamp(next.approval - 1, 0, 100)) };
    next = note(next, day, `${bill.name} was defeated ${vote.yes} to ${vote.no}.`);
    return { ok: true, outcome: { state: next, vote, passed: false, message: `${bill.name} was defeated ${vote.yes} to ${vote.no}.` } };
  }
  const taxes = { ...next.taxes };
  for (const k of Object.keys(bill.tax ?? {}) as (keyof Taxes)[]) taxes[k] = clamp(taxes[k] + (bill.tax?.[k] ?? 0), TAX_LIMITS[k][0], TAX_LIMITS[k][1]);
  const spending = { ...next.spending };
  for (const k of SECTORS) {
    const m = bill.spend?.[k];
    if (m) spending[k] = Math.round(clamp(spending[k] * m, DEFAULT_SPENDING[k] * MIN_SPEND_RATIO, DEFAULT_SPENDING[k] * MAX_SPEND_RATIO));
  }
  // Partners react to laws far from their own outlook.
  const satisfaction = { ...next.satisfaction };
  for (const p of next.partners) {
    const fit = compatibility(ctx.ideologies[p] ?? 'centrist-governance', bill.leaning);
    satisfaction[p] = clamp((satisfaction[p] ?? 50) + (fit < 0.35 ? -6 : fit > 0.6 ? 3 : 0), 0, 100);
  }
  next = { ...next, taxes, spending, satisfaction, approval: round1(clamp(next.approval + bill.approval, 0, 100)) };
  next = note(next, day, `${bill.name} passed ${vote.yes} to ${vote.no}.`);
  return { ok: true, outcome: { state: next, vote, passed: true, message: `${bill.name} passed ${vote.yes} to ${vote.no}.` } };
}

/** The player's party and partners each hold a share of the 12 posts. Fair share = seats share. */
function fairness(s: GovState, ctx: GovContext, partner: string): number {
  const group = govParties(s, ctx.government);
  const totalSeats = group.reduce((n, p) => n + (ctx.result.seats[p] ?? 0), 0);
  const seatShare = totalSeats > 0 ? (ctx.result.seats[partner] ?? 0) / totalSeats : 0;
  const owners = ministryOwners({ ...ctx.government, partners: s.partners, ministries: groupMinistries(s, ctx) });
  const posts = Object.values(owners).filter((o) => o === partner).length;
  const postShare = posts / MINISTRIES;
  return seatShare > 0 ? postShare / seatShare : 1;
}

/** Ministries are re-shared among whoever is still in the government. */
export function groupMinistries(s: GovState, ctx: GovContext): Record<string, number> {
  const group = govParties(s, ctx.government);
  const parts = apportion(MINISTRIES, group.map((p) => ctx.result.seats[p] ?? 0));
  const out: Record<string, number> = {};
  group.forEach((p, i) => { out[p] = parts[i]; });
  return out;
}


/** Answer the crisis that is waiting. Costs come from the government treasury. */
export function respondToCrisis(s: GovState, ctx: GovContext, optionIdx: number, day: number): Action {
  if (s.status !== 'governing') return { ok: false, error: 'The government has fallen.' };
  if (!s.crisis) return { ok: false, error: 'There is no crisis to handle.' };
  const def = CRISIS_BY_ID[s.crisis.id];
  const opt = def.options[optionIdx];
  if (!opt) return { ok: false, error: 'That is not an option.' };
  if (opt.cost > s.treasury) return { ok: false, error: `The treasury has ₹${s.treasury.toLocaleString()} crore; this needs ₹${opt.cost.toLocaleString()} crore.` };
  const owners = ministryOwners({ ...ctx.government, partners: s.partners, ministries: groupMinistries(s, ctx) });
  const minister = ministerEffect(def, s.cabinet, owners, ctx.members, PLAYER_ID);
  const eff = optionEffect(def, opt, s.economy, minister);
  const satisfaction = { ...s.satisfaction };
  for (const p of s.partners) satisfaction[p] = clamp((satisfaction[p] ?? 50) + eff.partner, 0, 100);
  let next: GovState = {
    ...s, treasury: s.treasury - opt.cost, economy: eff.economy, satisfaction,
    approval: clampApproval(s.approval + eff.approval), crisis: null,
    crisisLog: [...s.crisisLog, { id: def.id, day, choice: optionIdx, approvalChange: eff.approval }].slice(-20),
  };
  const msg = `${def.name}: ${opt.label}.`;
  next = note(next, day, msg);
  return { ok: true, state: next, message: msg };
}

/** A crisis nobody answered in time. */
function expireCrisis(s: GovState, day: number): GovState {
  if (!s.crisis) return s;
  const def = CRISIS_BY_ID[s.crisis.id];
  const eff = ignoredEffect(def, s.economy);
  const satisfaction = { ...s.satisfaction };
  for (const p of s.partners) satisfaction[p] = clamp((satisfaction[p] ?? 50) + eff.partner, 0, 100);
  const next: GovState = {
    ...s, economy: eff.economy, satisfaction, approval: clampApproval(s.approval + eff.approval), crisis: null,
    crisisLog: [...s.crisisLog, { id: def.id, day, choice: null, approvalChange: eff.approval }].slice(-20),
  };
  return note(next, day, `${def.name} was left unanswered and got worse.`);
}

export interface MonthReport { day: number; revenue: number; spent: number; interest: number; borrowed: number; events: string[] }

/** Runs every full month that has passed up to `day`. Members are needed so departed ministers lose their posts. */
export function advanceGovernment(s: GovState, ctx: GovContext, day: number): { state: GovState; reports: MonthReport[]; events: string[] } {
  let state = s;
  const reports: MonthReport[] = [];
  let guard = 0;
  while (state.status === 'governing' && state.lastMonthDay + MONTH_DAYS <= day && guard++ < 120) {
    const monthDay = state.lastMonthDay + MONTH_DAYS;
    const events: string[] = [];
    // Months wait for an open crisis until it is answered or its deadline passes.
    if (state.crisis) {
      if (day < state.crisis.deadline) break;
      events.push(`${CRISIS_BY_ID[state.crisis.id].name} was left unanswered.`);
      state = expireCrisis(state, day);
    }
    const owners = ministryOwners({ ...ctx.government, partners: state.partners, ministries: groupMinistries(state, ctx) });
    const pruned = pruneCabinet(state.cabinet, ctx.members);
    for (const k of Object.keys(pruned.cabinet)) if (owners[k] !== PLAYER_ID) delete pruned.cabinet[k]; // posts handed to partners
    if (pruned.removed.length) events.push(`${pruned.removed.length} minister(s) left the party and lost their posts.`);
    const ministryMetrics = { ...state.ministryMetrics };
    for (const d of MINISTRY_DEFS) {
      const current = ministryMetrics[d.id] ?? { performance: 55, budget: 500, complaints: 0, ministerSatisfaction: 60 };
      const holder = pruned.cabinet[d.id];
      ministryMetrics[d.id] = { ...current, performance: Math.max(0, current.performance - (holder ? 1 : 2)), complaints: current.complaints + (holder ? 1 : 2), ministerSatisfaction: Math.max(0, current.ministerSatisfaction - (current.performance < 35 ? 3 : 0)) };
    }
    const removed = [...state.ministryRemoved];
    if (ctx.government.playerRole === 'partner') {
      for (const d of MINISTRY_DEFS) {
        const m = ministryMetrics[d.id];
        if (owners[d.id] === PLAYER_ID && !removed.includes(d.id) && m.performance < 25 && m.complaints >= 8) {
          removed.push(d.id); delete pruned.cabinet[d.id]; events.push(`The Prime Minister withdrew the ${d.name} ministry from your party after sustained poor performance.`);
        }
      }
    }
    const quality = cabinetQuality(pruned.cabinet, owners, ctx.members);
    const rng = new Rng(ctx.seed ^ hashString(`month:${monthDay}`));
    const out = stepMonth({
      economy: state.economy, treasury: state.treasury, taxes: state.taxes, spending: state.spending,
      cabinetQuality: quality, billGrowth: billGrowth(state, monthDay), approval: state.approval, rng,
    });
    // Partner moods
    const satisfaction = { ...state.satisfaction };
    for (const p of state.partners) {
      const fair = fairness(state, ctx, p);
      const delta = (fair - 1) * 5 + (out.approval - 50) * 0.06 + (55 - (satisfaction[p] ?? 50)) * 0.05;
      satisfaction[p] = round1(clamp((satisfaction[p] ?? 50) + delta, 0, 100));
    }
    state = { ...state, cabinet: pruned.cabinet, ministryMetrics, ministryRemoved: removed, economy: out.economy, treasury: out.treasury, approval: out.approval, satisfaction, lastMonthDay: monthDay };
    if (out.borrowed > 0) events.push(`The treasury ran dry; ₹${out.borrowed.toLocaleString()} crore was borrowed.`);
    // A partner walks out when it is very unhappy.
    const leaving = state.partners.filter((p) => (satisfaction[p] ?? 50) < 20);
    if (leaving.length) {
      state = { ...state, partners: state.partners.filter((p) => !leaving.includes(p)) };
      for (const p of leaving) events.push(`${p} withdrew from the coalition.`);
      const cv = confidenceVote({
        seed: ctx.seed, day: monthDay, seats: ctx.result.seats, ideologies: ctx.ideologies,
        leaderId: ctx.government.leaderId, govParties: govParties(state, ctx.government), approval: state.approval,
      });
      if (cv.survives) events.push(`Confidence vote survived with ${cv.yes} votes.`);
      else {
        events.push(`Confidence vote lost (${cv.yes} of ${ctx.result.constituencies.length}). The government has fallen.`);
        state = { ...state, status: 'fallen', fallenReason: `Lost a confidence vote on Day ${monthDay} after ${leaving.join(', ')} left the coalition.` };
      }
    }
    // Voters can also bring a government down: very low approval for a government without a majority of its own.
    if (state.status === 'governing' && state.approval < 12 && govSeats(state, ctx) < 91 + 10) {
      state = { ...state, status: 'fallen', fallenReason: `Public anger (approval ${state.approval}%) broke the government on Day ${monthDay}.` };
      events.push('Approval collapsed and the government fell.');
    }
    if (state.status === 'governing') {
      const id = rollCrisis(ctx.seed, monthDay, state.lastCrisisDay);
      if (id) {
        state = { ...state, crisis: { id, startDay: day, deadline: day + CRISIS_WINDOW_DAYS }, lastCrisisDay: monthDay };
        events.push(`Crisis: ${CRISIS_BY_ID[id].name}. It needs your decision.`);
      }
    }
    if (state.status === 'governing') {
      state = { ...state, protests: monthlyProtests(state.protests) };
      const pr = rollProtest(ctx.seed, monthDay, day, state);
      if (pr) {
        state = { ...state, protests: { ...state.protests, active: pr, lastProtestDay: monthDay } };
        events.push(`Protest: ${PROTEST_CAUSES[pr.cause].name}. ${pr.size.toLocaleString()} people are outside the Prime Minister's office.`);
      }
    }
    for (const e of events) state = note(state, monthDay, e);
    reports.push({ day: monthDay, revenue: out.revenue, spent: out.spent, interest: out.interest, borrowed: out.borrowed, events });
    if (state.crisis) break;
  }
  // Protests and promises are checked every day, not only at month ends.
  const settled = settleProtests(state, ctx.seed, day);
  return { state: settled.state, reports, events: settled.events };
}
