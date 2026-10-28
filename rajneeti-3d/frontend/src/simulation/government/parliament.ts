import { MAJORITY_SEATS } from '../../data/constants';
import { Rng, hashString } from '../core/rng';
import type { Ideology } from '../parties/types';
import { compatibility } from '../election/coalition';
import { IND_ID } from '../election/types';
import type { Bill } from './types';

const clamp = (n: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, n));

export interface VoteInput {
  seed: number;
  day: number;
  bill: Bill;
  /** partyId (or IND) -> seats. */
  seats: Record<string, number>;
  ideologies: Record<string, Ideology>;
  leaderId: string;
  /** Parties in the government, leader first. */
  govParties: string[];
  /** partnerId -> 0..100 */
  satisfaction: Record<string, number>;
}

export interface VoteRow { partyId: string; seats: number; yes: number; no: number; abstain: number }
export interface VoteResult { rows: VoteRow[]; yes: number; no: number; abstain: number; passed: boolean }

/** One floor vote. Deterministic for a given seed, day and bill. Every seat votes yes, no or abstains. */
export function voteOnBill(i: VoteInput): VoteResult {
  const rng = new Rng(i.seed ^ hashString(`vote:${i.bill.id}:${i.day}`));
  const rows: VoteRow[] = [];
  for (const partyId of Object.keys(i.seats).sort()) {
    const seats = i.seats[partyId];
    if (!(seats > 0)) continue;
    const ideology = i.ideologies[partyId] ?? 'centrist-governance';
    const fit = compatibility(ideology, i.bill.leaning);
    const noise = (rng.next() - 0.5) * 0.16;
    let yes: number;
    let no: number;
    if (partyId === i.leaderId) {
      yes = Math.round(seats * clamp(0.96 + noise * 0.2));
      no = 0;
    } else if (i.govParties.includes(partyId)) {
      const loyalty = (i.satisfaction[partyId] ?? 50) / 100;
      const pYes = clamp(0.45 + 0.35 * fit + 0.2 * loyalty + noise);
      yes = Math.round(seats * pYes);
      no = Math.round(seats * clamp((1 - pYes) * (fit < 0.3 ? 0.7 : 0.2)));
    } else {
      const pYes = clamp(fit - 0.25 + noise);
      const pNo = clamp(0.75 - fit + noise);
      yes = Math.round(seats * pYes);
      no = Math.round(seats * Math.min(pNo, 1 - pYes));
    }
    yes = Math.min(seats, Math.max(0, yes));
    no = Math.min(seats - yes, Math.max(0, no));
    rows.push({ partyId, seats, yes, no, abstain: seats - yes - no });
  }
  const yes = rows.reduce((s, r) => s + r.yes, 0);
  const no = rows.reduce((s, r) => s + r.no, 0);
  const abstain = rows.reduce((s, r) => s + r.abstain, 0);
  return { rows, yes, no, abstain, passed: yes > no };
}

export interface ConfidenceInput {
  seed: number;
  day: number;
  seats: Record<string, number>;
  ideologies: Record<string, Ideology>;
  leaderId: string;
  govParties: string[];
  approval: number;
}

/** After a partner leaves, the government must show it still has 91 votes. Friendly outsiders may help. */
export function confidenceVote(i: ConfidenceInput): { yes: number; survives: boolean; outside: number } {
  const own = i.govParties.reduce((s, p) => s + (i.seats[p] ?? 0), 0);
  if (own >= MAJORITY_SEATS) return { yes: own, survives: true, outside: 0 };
  const rng = new Rng(i.seed ^ hashString(`confidence:${i.day}`));
  let outside = 0;
  for (const [p, seats] of Object.entries(i.seats)) {
    if (i.govParties.includes(p) || !(seats > 0)) continue;
    const fit = compatibility(i.ideologies[p] ?? 'centrist-governance', i.ideologies[i.leaderId] ?? 'centrist-governance');
    const lean = p === IND_ID ? 0.45 : fit;
    const chance = clamp((lean - 0.45) * 1.6 + (i.approval - 50) / 200 + (rng.next() - 0.5) * 0.2);
    outside += Math.round(seats * chance);
  }
  const yes = own + outside;
  return { yes, survives: yes >= MAJORITY_SEATS, outside };
}
