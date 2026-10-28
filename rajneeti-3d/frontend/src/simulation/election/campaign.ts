import { CAMPAIGN_START_DAY, ELECTION_DAY } from '../../data/constants';
import { spendFunds } from '../parties/finance';
import type { Constituency } from '../parties/types';
import type { Assignments } from '../candidates/tickets';
import type { CampaignState, LocalCampaign } from './types';
import type { CampaignWindow } from '../world/term';

const DEFAULT_WINDOW: CampaignWindow = { start: CAMPAIGN_START_DAY, end: ELECTION_DAY };

export const RALLY_COST = 1.5; // crore
export const MAX_RALLIES = 3;
export const MIN_AD_SPEND = 0.5; // crore
export const MAX_AD_SPEND = 6; // crore per constituency

export type CampaignResult = { ok: true; funds: number; campaign: CampaignState } | { ok: false; error: string };

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function emptyCampaign(): CampaignState {
  return { nationalSpend: 0, local: {}, totalSpent: 0 };
}

export function campaignOpen(day: number, w: CampaignWindow = DEFAULT_WINDOW): boolean {
  return day >= w.start && day < w.end;
}

/** Score points a local campaign adds. Diminishing returns, capped at about 5.6. */
export function localBoost(l: LocalCampaign | undefined): number {
  if (!l) return 0;
  return 3.2 * (1 - Math.exp(-l.adSpend / 3)) + 2.4 * (1 - Math.exp(-l.rallies / 1.5));
}

/** Popularity points national advertising adds. Diminishing returns, capped at 4. */
export function nationalBoost(spend: number): number {
  return 4 * (1 - Math.exp(-spend / 25));
}

function closedMessage(day: number, w: CampaignWindow): string {
  return day < w.start ? `The campaign season starts on Day ${w.start}.` : 'The campaign is over.';
}

function checkSeat(day: number, cs: Constituency[], a: Assignments, constituencyId: string, w: CampaignWindow): string | null {
  if (!campaignOpen(day, w)) return closedMessage(day, w);
  if (!cs.some((c) => c.id === constituencyId)) return `Invalid constituency ${constituencyId}.`;
  if (!a[constituencyId]) return 'You have no official candidate there, so campaigning would be wasted.';
  return null;
}

function withLocal(c: CampaignState, id: string, patch: Partial<LocalCampaign>, spent: number): CampaignState {
  const old = c.local[id] ?? { rallies: 0, adSpend: 0 };
  return { ...c, totalSpent: round2(c.totalSpent + spent), local: { ...c.local, [id]: { ...old, ...patch } } };
}

export function holdRally(funds: number, campaign: CampaignState, day: number, cs: Constituency[], a: Assignments, constituencyId: string, w: CampaignWindow = DEFAULT_WINDOW): CampaignResult {
  const err = checkSeat(day, cs, a, constituencyId, w);
  if (err) return { ok: false, error: err };
  const old = campaign.local[constituencyId] ?? { rallies: 0, adSpend: 0 };
  if (old.rallies >= MAX_RALLIES) return { ok: false, error: `Already held ${MAX_RALLIES} rallies there; more would not help.` };
  const paid = spendFunds(funds, RALLY_COST);
  if (!paid.ok) return paid;
  return { ok: true, funds: paid.funds, campaign: withLocal(campaign, constituencyId, { rallies: old.rallies + 1 }, RALLY_COST) };
}

export function buyLocalAds(funds: number, campaign: CampaignState, day: number, cs: Constituency[], a: Assignments, constituencyId: string, amount: number, w: CampaignWindow = DEFAULT_WINDOW): CampaignResult {
  const err = checkSeat(day, cs, a, constituencyId, w);
  if (err) return { ok: false, error: err };
  if (!Number.isFinite(amount) || amount < MIN_AD_SPEND) return { ok: false, error: `Minimum ad spend is ₹${MIN_AD_SPEND} crore.` };
  const old = campaign.local[constituencyId] ?? { rallies: 0, adSpend: 0 };
  if (old.adSpend + amount > MAX_AD_SPEND) return { ok: false, error: `Local ads are capped at ₹${MAX_AD_SPEND} crore per constituency.` };
  const paid = spendFunds(funds, amount);
  if (!paid.ok) return paid;
  return { ok: true, funds: paid.funds, campaign: withLocal(campaign, constituencyId, { adSpend: round2(old.adSpend + amount) }, amount) };
}

export function buyNationalAds(funds: number, campaign: CampaignState, day: number, amount: number, w: CampaignWindow = DEFAULT_WINDOW): CampaignResult {
  if (!campaignOpen(day, w)) return { ok: false, error: closedMessage(day, w) };
  if (!Number.isFinite(amount) || amount < MIN_AD_SPEND) return { ok: false, error: `Minimum ad spend is ₹${MIN_AD_SPEND} crore.` };
  const paid = spendFunds(funds, amount);
  if (!paid.ok) return paid;
  return { ok: true, funds: paid.funds, campaign: { ...campaign, nationalSpend: round2(campaign.nationalSpend + amount), totalSpent: round2(campaign.totalSpent + amount) } };
}
