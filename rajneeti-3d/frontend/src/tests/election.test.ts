import { describe, expect, it } from 'vitest';
import { generateMembers } from '../simulation/candidates/members';
import { generateConstituencies } from '../simulation/candidates/constituencies';
import { autoAssign } from '../simulation/candidates/tickets';
import { generateRivals, partyIdeology } from '../simulation/election/parties';
import { apportion, applyResultsToMembers, battlegrounds, pollProjection, runElection } from '../simulation/election/model';
import { MAX_RALLIES, RALLY_COST, buyLocalAds, buyNationalAds, campaignOpen, emptyCampaign, holdRally, localBoost, nationalBoost } from '../simulation/election/campaign';
import { autoGovernment, compatibility, coalitionOffers, formCoalition, resolveElection, standings } from '../simulation/election/coalition';
import { validateCampaign, validateElectionOutcome } from '../simulation/election/validate';
import { IND_ID, PLAYER_ID } from '../simulation/election/types';
import type { ElectionContext, ElectionResult } from '../simulation/election/types';
import { MAJORITY_SEATS } from '../data/constants';

function makeCtx(seed: number, patch: Partial<ElectionContext> = {}, popularity = 35): ElectionContext {
  const members = generateMembers(seed);
  const constituencies = generateConstituencies(seed);
  const assignments = autoAssign({}, members, constituencies);
  return {
    seed, day: 181, constituencies, members, assignments, rivals: generateRivals(seed),
    player: { name: 'Bharat Vikas Dal', abbreviation: 'BVD', color: '#ff9f1c', ideology: partyIdeology(members, assignments), popularity },
    campaign: emptyCampaign(),
    ...patch,
  };
}

const ctx = makeCtx(42);
const result = runElection(ctx);
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe('rival parties', () => {
  it('creates five distinct, deterministic rivals', () => {
    const a = generateRivals(42);
    expect(a).toHaveLength(5);
    expect(new Set(a.map((r) => r.id)).size).toBe(5);
    expect(generateRivals(42)).toEqual(a);
    expect(generateRivals(43)).not.toEqual(a);
    expect(a.every((r) => r.strength >= 0 && r.strength <= 100)).toBe(true);
  });
  it('player ideology follows the candidates, and is centrist with none', () => {
    expect(partyIdeology(ctx.members, {})).toBe('centrist-governance');
    const m = ctx.members[0];
    expect(partyIdeology(ctx.members, { C001: m.id })).toBe(m.ideology);
  });
});

describe('vote apportionment', () => {
  it('always adds up exactly and never goes negative', () => {
    for (const [total, w] of [[1000, [1, 1, 1]], [7, [5, 3, 2]], [123457, [0.1, 9.7, 3.3, 0.0001]], [0, [1, 2]], [5, [0, 0]]] as [number, number[]][]) {
      const parts = apportion(total, w);
      expect(parts.every((p) => p >= 0)).toBe(true);
      if (total > 0 && sum(w) > 0) expect(sum(parts)).toBe(total);
    }
  });
});

describe('election day', () => {
  it('is reproducible for the same game and differs between games', () => {
    expect(runElection(ctx)).toEqual(result);
    expect(runElection(makeCtx(43)).seats).not.toEqual(result.seats);
  });
  it('awards exactly 180 seats and counts every vote', () => {
    expect(result.constituencies).toHaveLength(180);
    expect(sum(Object.values(result.seats))).toBe(180);
    for (const r of result.constituencies) {
      expect(sum(r.entries.map((e) => e.votes))).toBe(r.cast);
      expect(r.cast).toBeLessThanOrEqual(r.eligible);
      expect(r.winnerParty).toBe(r.entries[0].partyId);
      expect(r.entries[0].votes).toBeGreaterThanOrEqual(r.entries[1].votes);
    }
    expect(sum(Object.values(result.votes))).toBe(result.totalCast);
    expect(result.turnout).toBeGreaterThan(40);
    expect(result.turnout).toBeLessThan(90);
  });
  it('the player only gets votes where there is an official candidate', () => {
    const seat = Object.keys(ctx.assignments)[0];
    const partial = runElection({ ...ctx, assignments: { ...ctx.assignments, [seat]: undefined as unknown as string } });
    const row = partial.constituencies.find((r) => r.constituencyId === seat)!;
    expect(row.playerContested).toBe(false);
    const none = runElection({ ...ctx, assignments: {} });
    expect(none.seats[PLAYER_ID]).toBe(0);
    expect(none.votes[PLAYER_ID]).toBe(0);
  });
  it('a stronger national mood wins more seats', () => {
    const weak = runElection(makeCtx(42, {}, 20)).seats[PLAYER_ID];
    const strong = runElection(makeCtx(42, {}, 55)).seats[PLAYER_ID];
    expect(strong).toBeGreaterThan(weak);
  });
  it('most games are not a one-party landslide at the start', () => {
    let majorities = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = runElection(makeCtx(seed)).seats;
      if (Object.entries(s).some(([id, n]) => id !== IND_ID && n >= MAJORITY_SEATS)) majorities++;
    }
    expect(majorities).toBeLessThan(10);
  });
  it('poll projections are close to, but not the same as, the real result', () => {
    const poll = pollProjection(ctx);
    expect(sum(Object.values(poll.seats))).toBe(180);
    expect(Math.abs(poll.seats[PLAYER_ID] - result.seats[PLAYER_ID])).toBeLessThan(45);
  });
});

describe('rebels and defectors', () => {
  it('an independent candidate stands, and can take the seat', () => {
    const rebel = ctx.members.find((m) => m.preferredConstituency === 'C010')!;
    const members = ctx.members.map((m) => (m.id === rebel.id ? { ...m, status: 'independent' as const, popularity: 100, reputation: 100, campaigning: 100 } : m));
    const assignments = { ...ctx.assignments };
    delete assignments.C010;
    const r = runElection({ ...ctx, members, assignments });
    const row = r.constituencies.find((c) => c.constituencyId === 'C010')!;
    expect(row.entries.some((e) => e.partyId === IND_ID && e.candidateName === rebel.name)).toBe(true);
    expect(row.winnerParty).toBe(IND_ID);
    expect(r.seats[IND_ID]).toBeGreaterThanOrEqual(1);
  });
  it('members who left the party cannot be its candidate', () => {
    const holder = ctx.assignments.C001;
    const members = ctx.members.map((m) => (m.id === holder ? { ...m, status: 'resigned' as const } : m));
    const r = runElection({ ...ctx, members });
    expect(r.constituencies[0].playerContested).toBe(false);
  });
  it('winners and losers carry their result into the next election', () => {
    const updated = applyResultsToMembers(ctx.members, ctx.assignments, result);
    const winnerSeat = result.constituencies.find((r) => r.winnerParty === PLAYER_ID);
    const loserSeat = result.constituencies.find((r) => r.playerContested && r.winnerParty !== PLAYER_ID);
    if (winnerSeat) {
      const m = updated.find((x) => x.id === ctx.assignments[winnerSeat.constituencyId])!;
      expect(m.role).toBe('Member of Parliament');
      expect(m.previousMargin).toBeGreaterThan(0);
    }
    if (loserSeat) {
      const m = updated.find((x) => x.id === ctx.assignments[loserSeat.constituencyId])!;
      expect(m.previousMargin).toBeLessThan(0);
    }
    expect(updated).toHaveLength(300);
  });
});

describe('campaign', () => {
  const day = 100;
  const seat = Object.keys(ctx.assignments)[0];
  it('only runs in the campaign season', () => {
    expect(campaignOpen(90)).toBe(false);
    expect(campaignOpen(91)).toBe(true);
    expect(campaignOpen(180)).toBe(true);
    expect(campaignOpen(181)).toBe(false);
    expect(holdRally(50, emptyCampaign(), 10, ctx.constituencies, ctx.assignments, seat).ok).toBe(false);
    expect(buyNationalAds(50, emptyCampaign(), 181, 5).ok).toBe(false);
  });
  it('rallies cost money, are capped, and need a candidate', () => {
    let funds = 50;
    let c = emptyCampaign();
    for (let i = 0; i < MAX_RALLIES; i++) {
      const r = holdRally(funds, c, day, ctx.constituencies, ctx.assignments, seat);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      funds = r.funds; c = r.campaign;
    }
    expect(funds).toBe(50 - MAX_RALLIES * RALLY_COST);
    expect(holdRally(funds, c, day, ctx.constituencies, ctx.assignments, seat).ok).toBe(false);
    expect(holdRally(50, emptyCampaign(), day, ctx.constituencies, {}, seat).ok).toBe(false);
    expect(holdRally(50, emptyCampaign(), day, ctx.constituencies, ctx.assignments, 'C999').ok).toBe(false);
  });
  it('refuses spending the party cannot afford or that makes no sense', () => {
    expect(holdRally(1, emptyCampaign(), day, ctx.constituencies, ctx.assignments, seat).ok).toBe(false);
    expect(buyLocalAds(50, emptyCampaign(), day, ctx.constituencies, ctx.assignments, seat, -2).ok).toBe(false);
    expect(buyLocalAds(50, emptyCampaign(), day, ctx.constituencies, ctx.assignments, seat, NaN).ok).toBe(false);
    expect(buyLocalAds(50, emptyCampaign(), day, ctx.constituencies, ctx.assignments, seat, 7).ok).toBe(false);
    expect(buyNationalAds(3, emptyCampaign(), day, 5).ok).toBe(false);
  });
  it('has diminishing returns and a ceiling', () => {
    expect(localBoost({ rallies: 1, adSpend: 0 })).toBeGreaterThan(0);
    const first = localBoost({ rallies: 1, adSpend: 0 });
    const second = localBoost({ rallies: 2, adSpend: 0 }) - first;
    expect(second).toBeLessThan(first);
    expect(localBoost({ rallies: 3, adSpend: 6 })).toBeLessThan(5.7);
    expect(nationalBoost(1000)).toBeLessThan(4.0001);
    expect(nationalBoost(20)).toBeGreaterThan(nationalBoost(10));
  });
  it('spending on a seat helps the player there', () => {
    const target = ctx.constituencies.find((c) => ctx.assignments[c.id])!;
    let c = emptyCampaign();
    let funds = 50;
    for (let i = 0; i < 3; i++) {
      const r = holdRally(funds, c, day, ctx.constituencies, ctx.assignments, target.id);
      if (r.ok) { funds = r.funds; c = r.campaign; }
    }
    const ads = buyLocalAds(funds, c, day, ctx.constituencies, ctx.assignments, target.id, 4);
    if (ads.ok) c = ads.campaign;
    const share = (r: ElectionResult): number => r.constituencies.find((x) => x.constituencyId === target.id)!.entries.find((e) => e.partyId === PLAYER_ID)!.share;
    expect(share(runElection({ ...ctx, campaign: c }))).toBeGreaterThan(share(result));
  });
  it('battlegrounds list only seats the player contests, closest first', () => {
    const b = battlegrounds(pollProjection(ctx), 10);
    expect(b.length).toBeGreaterThan(0);
    for (let i = 1; i < b.length; i++) expect(b[i].marginPct).toBeGreaterThanOrEqual(b[i - 1].marginPct);
    expect(b.every((x) => !!ctx.assignments[x.constituencyId])).toBe(true);
  });
});

describe('coalitions and government', () => {
  const rivals = ctx.rivals;
  it('compatibility is symmetric, 0..1, and highest for the same ideology', () => {
    expect(compatibility('social-welfare', 'social-welfare')).toBe(1);
    expect(compatibility('social-welfare', 'economic-development')).toBe(compatibility('economic-development', 'social-welfare'));
    expect(compatibility('liberal-reform', 'traditional-conservatism')).toBeLessThan(compatibility('liberal-reform', 'centrist-governance'));
  });
  it('standings are sorted and leave out seatless parties', () => {
    const s = standings(result, rivals, ctx.player);
    for (let i = 1; i < s.length; i++) expect(s[i].seats).toBeLessThanOrEqual(s[i - 1].seats);
    expect(s.every((b) => b.seats > 0)).toBe(true);
  });
  it('a party with a majority governs alone, with nothing to negotiate', () => {
    const fake: ElectionResult = { ...result, seats: { PLAYER: 100, NPA: 40, JSM: 20, HKP: 10, RPD: 5, GFF: 5, IND: 0 } };
    const g = resolveElection(fake, rivals, ctx.player, 42);
    expect(g?.type).toBe('majority');
    expect(g?.leaderId).toBe(PLAYER_ID);
    expect(g?.playerRole).toBe('leader');
    const rivalWin: ElectionResult = { ...result, seats: { PLAYER: 30, NPA: 100, JSM: 20, HKP: 10, RPD: 10, GFF: 10, IND: 0 } };
    expect(resolveElection(rivalWin, rivals, ctx.player, 42)?.playerRole).toBe('opposition');
  });
  const hung: ElectionResult = { ...result, seats: { PLAYER: 60, NPA: 50, JSM: 40, HKP: 20, RPD: 6, GFF: 4, IND: 0 } };
  it('a hung result needs negotiation', () => {
    expect(resolveElection(hung, rivals, ctx.player, 42)).toBeNull();
  });
  it('coalitions need 91 seats and willing partners', () => {
    const tooSmall = formCoalition(hung, rivals, ctx.player, 42, ['GFF']);
    expect(tooSmall.ok).toBe(false);
    expect(formCoalition(hung, rivals, ctx.player, 42, ['ZZZ']).ok).toBe(false);
    const offers = coalitionOffers(hung, rivals, ctx.player, 42);
    expect(offers.map((o) => o.bloc.id)).not.toContain(PLAYER_ID);
    expect(offers.every((o) => o.compatibility >= 0 && o.compatibility <= 1)).toBe(true);
    const everyone = formCoalition(hung, rivals, ctx.player, 42, offers.map((o) => o.bloc.id));
    if (everyone.ok) expect(everyone.government.seats).toBeGreaterThanOrEqual(MAJORITY_SEATS);
    else expect(everyone.error).toMatch(/refuses|needed/);
    expect(formCoalition(hung, rivals, ctx.player, 42, ['NPA', 'NPA']).ok).toBe(formCoalition(hung, rivals, ctx.player, 42, ['NPA']).ok);
  });
  it('a successful coalition is led by the largest party and shares exactly 12 ministries', () => {
    let found = 0;
    for (let seed = 1; seed <= 60 && found < 3; seed++) {
      const rv = generateRivals(seed);
      const player = { ...ctx.player, ideology: 'centrist-governance' as const };
      const res: ElectionResult = { ...result, seats: { PLAYER: 55, NPA: 50, JSM: 45, HKP: 20, RPD: 6, GFF: 4, IND: 0 } };
      const out = formCoalition(res, rv, player, seed, ['NPA', 'JSM', 'HKP']);
      if (!out.ok) continue;
      found++;
      expect(out.government.leaderId).toBe(PLAYER_ID);
      expect(out.government.playerRole).toBe('leader');
      expect(sum(Object.values(out.government.ministries))).toBe(12);
      expect(out.government.seats).toBe(170);
    }
    expect(found).toBeGreaterThan(0);
  });
  it('a smaller player can join a bigger party and becomes a junior partner', () => {
    const res: ElectionResult = { ...result, seats: { PLAYER: 45, NPA: 70, JSM: 40, HKP: 15, RPD: 6, GFF: 4, IND: 0 } };
    let ok = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const out = formCoalition(res, generateRivals(seed), { ...ctx.player, ideology: 'economic-development' }, seed, ['NPA']);
      if (out.ok) {
        ok++;
        expect(out.government.leaderId).toBe('NPA');
        expect(out.government.playerRole).toBe('partner');
      }
    }
    expect(ok).toBeGreaterThan(0);
  });
  it('without the player, the rest of parliament still forms a government', () => {
    const g = autoGovernment(hung, rivals, ctx.player, 42, true);
    expect(g.playerRole).toBe('opposition');
    expect(g.leaderId).not.toBe(PLAYER_ID);
    expect(g.seats).toBeGreaterThan(0);
    if (g.type !== 'minority') expect(g.seats).toBeGreaterThanOrEqual(MAJORITY_SEATS);
    expect(autoGovernment(hung, rivals, ctx.player, 42, true)).toEqual(g);
    const scattered: ElectionResult = { ...result, seats: { PLAYER: 36, NPA: 36, JSM: 36, HKP: 36, RPD: 36, GFF: 0, IND: 0 } };
    expect(['coalition', 'minority']).toContain(autoGovernment(scattered, rivals, ctx.player, 42, true).type);
  });
});

describe('saving the election', () => {
  const cs = ctx.constituencies;
  it('round-trips a hung and a formed outcome through JSON', () => {
    const hungOutcome = { result, stage: 'hung' as const, government: null };
    expect(validateElectionOutcome(JSON.parse(JSON.stringify(hungOutcome)), cs)).toEqual(hungOutcome);
    const gov = autoGovernment(result, ctx.rivals, ctx.player, 42, true);
    const formed = { result, stage: 'formed' as const, government: gov };
    expect(validateElectionOutcome(JSON.parse(JSON.stringify(formed)), cs)).toEqual(formed);
  });
  it('rejects tampered or inconsistent results', () => {
    const base = JSON.parse(JSON.stringify({ result, stage: 'hung', government: null }));
    expect(validateElectionOutcome(null, cs)).toBeNull();
    expect(validateElectionOutcome({ ...base, stage: 'formed' }, cs)).toBeNull(); // formed needs a government
    expect(validateElectionOutcome({ ...base, government: { type: 'majority' } }, cs)).toBeNull();
    const badVotes = JSON.parse(JSON.stringify(base));
    badVotes.result.constituencies[0].entries[0].votes += 1;
    expect(validateElectionOutcome(badVotes, cs)).toBeNull();
    const badSeats = JSON.parse(JSON.stringify(base));
    badSeats.result.seats[PLAYER_ID] += 1;
    expect(validateElectionOutcome(badSeats, cs)).toBeNull();
    const missing = JSON.parse(JSON.stringify(base));
    missing.result.constituencies.pop();
    expect(validateElectionOutcome(missing, cs)).toBeNull();
  });
  it('validates campaign state', () => {
    const c = { nationalSpend: 5, totalSpent: 8, local: { C001: { rallies: 2, adSpend: 1 } } };
    expect(validateCampaign(c, cs)).toEqual(c);
    expect(validateCampaign({ ...c, nationalSpend: -1 }, cs)).toBeNull();
    expect(validateCampaign({ ...c, local: { C999: { rallies: 1, adSpend: 0 } } }, cs)).toBeNull();
    expect(validateCampaign({ ...c, local: { C001: { rallies: 1.5, adSpend: 0 } } }, cs)).toBeNull();
    expect(validateCampaign(null, cs)).toBeNull();
  });
});
