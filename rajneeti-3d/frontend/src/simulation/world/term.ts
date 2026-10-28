import { CAMPAIGN_START_DAY, ELECTION_DAY } from '../../data/constants';
import type { Member } from '../parties/types';

/** Days between two scheduled elections (five years of 360 days). */
export const TERM_DAYS = 1800;
/** The campaign season opens this many days before election day. */
export const CAMPAIGN_LEAD_DAYS = 90;
/** An early election is held this many days after it is called. */
export const EARLY_ELECTION_DAYS = 45;
export const EARLY_CAMPAIGN_DAYS = 5;

export interface TermState {
  /** Which election this term refers to: 1 = the first one. */
  number: number;
  campaignStartDay: number;
  electionDay: number;
  /** True once the election for `number` has been held. */
  held: boolean;
  /** Set when `held` is true: the day the next scheduled election falls on. */
  nextElectionDay: number | null;
}

export interface CampaignWindow { start: number; end: number }

export interface PastElection {
  term: number;
  day: number;
  seats: Record<string, number>;
  voteShare: Record<string, number>;
  leaderId: string | null;
  playerRole: 'leader' | 'partner' | 'opposition' | null;
  early: boolean;
}

export function firstTerm(): TermState {
  return { number: 1, campaignStartDay: CAMPAIGN_START_DAY, electionDay: ELECTION_DAY, held: false, nextElectionDay: null };
}

export function windowOf(t: TermState): CampaignWindow { return { start: t.campaignStartDay, end: t.electionDay }; }

/** The election the player is heading towards: the one in this term, or the next scheduled one. */
export function nextElectionDayOf(t: TermState): number {
  return t.held ? (t.nextElectionDay ?? t.electionDay) : t.electionDay;
}

/** Marks the term's election as held on `day` and schedules the next one. */
export function markHeld(t: TermState, day: number): TermState {
  return { ...t, held: true, nextElectionDay: day + TERM_DAYS };
}

/** True once the campaign season for the next scheduled election has begun. */
export function cycleDue(t: TermState, day: number): boolean {
  return t.held && t.nextElectionDay !== null && day >= t.nextElectionDay - CAMPAIGN_LEAD_DAYS;
}

/** Opens the next scheduled election cycle. */
export function advanceTerm(t: TermState): TermState {
  const next = t.nextElectionDay ?? t.electionDay + TERM_DAYS;
  return { number: t.number + 1, campaignStartDay: next - CAMPAIGN_LEAD_DAYS, electionDay: next, held: false, nextElectionDay: null };
}

/** Pulls the next election forward. Never pushes it later. */
export function earlyTerm(t: TermState, day: number): TermState {
  const base = t.held ? { ...advanceTerm(t) } : { ...t };
  const electionDay = Math.min(base.electionDay, day + EARLY_ELECTION_DAYS);
  const campaignStartDay = Math.min(base.campaignStartDay, Math.min(day + EARLY_CAMPAIGN_DAYS, electionDay - 1));
  return { ...base, electionDay, campaignStartDay, held: false, nextElectionDay: null };
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** Five years on: members are older and more experienced, the very old retire, loyalty settles. */
export function rolloverMembers(members: Member[]): Member[] {
  return members.map((m) => {
    const age = m.age + 5;
    return {
      ...m, age,
      experience: clamp(m.experience + (m.status === 'active' ? 4 : 0), 0, 60),
      loyalty: m.status === 'active' ? Math.round(m.loyalty + (60 - m.loyalty) * 0.3) : m.loyalty,
      opposesLeadership: false,
      status: m.status === 'active' && age >= 78 ? 'resigned' : m.status,
    };
  });
}

/** Party popularity after a term. A governing party carries its approval, an opposition party its standing. */
export function carryPopularity(popularity: number, gov: { approval: number } | null, opp: { standing: number; rulingApproval: number } | null): number {
  if (gov) return clamp(Math.round((popularity * 0.5 + gov.approval * 0.5) * 10) / 10, 5, 90);
  if (opp) return clamp(Math.round((popularity + (opp.standing - 50) * 0.1 + (50 - opp.rulingApproval) * 0.1) * 10) / 10, 5, 90);
  return popularity;
}

export function describeEarly(reason: string): string { return `Early election called: ${reason}`; }

/** Monthly party donations in crore. Only flows once the first election is over. */
export function monthlyDonations(popularity: number, inPower: boolean): number {
  return Math.round((0.4 + popularity * 0.03 + (inPower ? 0.6 : 0)) * 100) / 100;
}

/** How many whole months of income are owed between `fromDay` and `day`. */
export function incomeMonths(fromDay: number, day: number): number {
  return Math.max(0, Math.floor((day - fromDay) / 30));
}
