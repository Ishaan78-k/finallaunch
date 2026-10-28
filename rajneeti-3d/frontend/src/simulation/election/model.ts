import { Rng, hashString } from '../core/rng';
import { FIRST, LAST } from '../candidates/members';
import { suitability } from '../candidates/suitability';
import { ideologyFit } from './parties';
import { localBoost, nationalBoost } from './campaign';
import { IND_ID, PLAYER_ID } from './types';
import type { BallotEntry, ConstituencyResult, ElectionContext, ElectionResult, RivalParty } from './types';
import type { Constituency, Member } from '../parties/types';

/** Higher = results follow score gaps more strongly. A 10 point gap makes a party about 2x as popular. */
const TEMPERATURE = 14;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Split `total` whole votes by weight so the parts add up to exactly `total` (largest remainder method). */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (weights.length === 0 || total <= 0 || sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / sum) * total);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((s, v) => s + v, 0);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k].i]++;
  return out;
}

interface RivalCandidate { name: string; quality: number }

/** The same rival candidate always stands in the same seat for a given game. */
export function rivalCandidate(seed: number, partyId: string, constituencyId: string): RivalCandidate {
  const rng = new Rng(seed ^ hashString(`${partyId}:${constituencyId}`));
  return { name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`, quality: rng.bell(30, 80) };
}

/** Which rival a defecting member goes to (stable per member). */
export function defectionTarget(seed: number, member: Member, rivals: RivalParty[]): RivalParty {
  return rivals[hashString(`${seed}:${member.id}`) % rivals.length];
}

interface Contender { key: string; partyId: string; name: string; score: number }

function contenders(ctx: ElectionContext, c: Constituency, swing: Record<string, number>, rng: Rng, noise: number): Contender[] {
  const byId = new Map(ctx.members.map((m) => [m.id, m]));
  const local = (): number => (rng.next() + rng.next() - 1) * 6 * noise; // triangular, +-6 points at full noise
  const list: Contender[] = [];

  const candId = ctx.assignments[c.id];
  const cand = candId ? byId.get(candId) : undefined;
  if (cand && cand.status === 'active') {
    const pop = ctx.player.popularity + nationalBoost(ctx.campaign.nationalSpend);
    const score =
      8 + 0.4 * suitability(cand, c) + 0.25 * pop + 0.15 * (c.historicalSupport * 2) +
      ideologyFit(ctx.player.ideology, c.profile) + localBoost(ctx.campaign.local[c.id]) -
      (cand.opposesLeadership ? 6 : 0) + swing[PLAYER_ID] + local();
    list.push({ key: PLAYER_ID, partyId: PLAYER_ID, name: cand.name, score });
  }

  for (const p of ctx.rivals) {
    const rc = rivalCandidate(ctx.seed, p.id, c.id);
    const defectors = ctx.members.filter((m) => m.status === 'joined-other-party' && m.preferredConstituency === c.id && defectionTarget(ctx.seed, m, ctx.rivals).id === p.id).length;
    const score =
      0.6 * p.strength + 0.25 * (p.regionAffinity[c.region] ?? 50) + 0.15 * rc.quality +
      ideologyFit(p.ideology, c.profile) + Math.min(12, defectors * 6) + swing[p.id] + local();
    list.push({ key: p.id, partyId: p.id, name: rc.name, score });
  }

  const independents = ctx.members.filter((m) => m.status === 'independent' && m.preferredConstituency === c.id).sort((a, b) => a.id.localeCompare(b.id));
  for (const m of independents) {
    const score = 0.5 * m.popularity + 0.25 * m.reputation + 0.25 * m.campaigning - 6 + local();
    list.push({ key: `${IND_ID}:${m.id}`, partyId: IND_ID, name: m.name, score });
  }
  return list;
}

/**
 * Runs the whole election. `noise` scales randomness: 1 = election day, below 1 = a poll estimate.
 * Same context + same rng seed always gives the same result.
 */
export function simulateElection(ctx: ElectionContext, rng: Rng, noise: number): ElectionResult {
  const swing: Record<string, number> = {};
  for (const id of [PLAYER_ID, ...ctx.rivals.map((r) => r.id)]) swing[id] = (rng.next() * 2 - 1) * 3 * noise;

  const results: ConstituencyResult[] = [];
  const seats: Record<string, number> = { [PLAYER_ID]: 0, [IND_ID]: 0 };
  const votes: Record<string, number> = { [PLAYER_ID]: 0, [IND_ID]: 0 };
  for (const r of ctx.rivals) { seats[r.id] = 0; votes[r.id] = 0; }
  let totalCast = 0;
  let totalEligible = 0;

  for (const c of ctx.constituencies) {
    const list = contenders(ctx, c, swing, rng, noise);
    const turnoutPct = clamp(50 + 0.1 * c.education + 0.08 * c.employment + 0.5 * localBoost(ctx.campaign.local[c.id]) + (rng.next() * 2 - 1) * 4 * noise, 45, 86);
    const cast = Math.round((c.eligibleVoters * turnoutPct) / 100);
    const top = Math.max(...list.map((l) => l.score));
    const weights = list.map((l) => Math.exp((l.score - top) / TEMPERATURE));
    const counts = apportion(cast, weights);
    const entries: BallotEntry[] = list
      .map((l, i) => ({ key: l.key, partyId: l.partyId, candidateName: l.name, votes: counts[i], share: cast > 0 ? round1((counts[i] / cast) * 100) : 0 }))
      .sort((a, b) => b.votes - a.votes || a.key.localeCompare(b.key));
    const winner = entries[0];
    results.push({
      constituencyId: c.id, eligible: c.eligibleVoters, cast, entries,
      winnerParty: winner.partyId,
      margin: entries.length > 1 ? winner.votes - entries[1].votes : winner.votes,
      playerContested: entries.some((e) => e.partyId === PLAYER_ID),
    });
    seats[winner.partyId]++;
    for (const e of entries) votes[e.partyId] = (votes[e.partyId] ?? 0) + e.votes;
    totalCast += cast;
    totalEligible += c.eligibleVoters;
  }

  const voteShare: Record<string, number> = {};
  for (const [id, v] of Object.entries(votes)) voteShare[id] = totalCast > 0 ? round1((v / totalCast) * 100) : 0;
  return { seed: ctx.seed, day: ctx.day, constituencies: results, seats, votes, voteShare, totalCast, turnout: totalEligible > 0 ? round1((totalCast / totalEligible) * 100) : 0 };
}

/** The real election result for this game. Fixed by the seed and the choices made, so reloading cannot reroll it. */
export function runElection(ctx: ElectionContext): ElectionResult {
  return simulateElection(ctx, new Rng(ctx.seed ^ 0x0e1ec710), 1);
}

/** A noisy poll. It changes a little from day to day and is not the final result. */
export function pollProjection(ctx: ElectionContext): ElectionResult {
  return simulateElection(ctx, new Rng(ctx.seed ^ hashString(`poll:${ctx.day}`)), 0.4);
}

export interface Battleground { constituencyId: string; marginPct: number; leader: string; playerShare: number }

/** Seats where the player stands and the projected race is closest. */
export function battlegrounds(projection: ElectionResult, limit = 12): Battleground[] {
  const out: Battleground[] = [];
  for (const r of projection.constituencies) {
    const me = r.entries.find((e) => e.partyId === PLAYER_ID);
    if (!me) continue;
    const best = r.entries.find((e) => e.key !== me.key) ?? me;
    const gap = r.winnerParty === PLAYER_ID ? me.share - best.share : best.share - me.share;
    out.push({ constituencyId: r.constituencyId, marginPct: round1(gap), leader: r.winnerParty, playerShare: me.share });
  }
  return out.sort((a, b) => a.marginPct - b.marginPct || a.constituencyId.localeCompare(b.constituencyId)).slice(0, limit);
}

/** After the election, winners and losers carry their result into next time. Returns new member objects. */
export function applyResultsToMembers(members: Member[], assignments: Record<string, string>, result: ElectionResult): Member[] {
  const outcome = new Map<string, { won: boolean; marginPct: number }>();
  for (const r of result.constituencies) {
    const memberId = assignments[r.constituencyId];
    const me = r.entries.find((e) => e.partyId === PLAYER_ID);
    if (!memberId || !me) continue;
    const other = r.entries.find((e) => e.key !== me.key);
    const won = r.winnerParty === PLAYER_ID;
    const gap = other ? Math.abs(me.share - other.share) : me.share;
    outcome.set(memberId, { won, marginPct: round1(won ? gap : -gap) });
  }
  return members.map((m) => {
    const o = outcome.get(m.id);
    if (!o) return m;
    return {
      ...m,
      previousMargin: o.marginPct,
      popularity: clamp(m.popularity + (o.won ? 3 : -2), 0, 100),
      role: o.won ? 'Member of Parliament' : m.role,
    };
  });
}
