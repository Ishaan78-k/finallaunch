import { describe, expect, it } from 'vitest';
import { generateMembers } from '../simulation/candidates/members';
import { generateConstituencies } from '../simulation/candidates/constituencies';
import { autoAssign } from '../simulation/candidates/tickets';
import { generateRivals, partyIdeology } from '../simulation/election/parties';
import { runElection } from '../simulation/election/model';
import { buyNationalAds, campaignOpen, emptyCampaign, holdRally } from '../simulation/election/campaign';
import { autoGovernment, formCoalition, resolveElection, standings } from '../simulation/election/coalition';
import { PLAYER_ID, type ElectionContext, type Government } from '../simulation/election/types';
import { daysUntilElection } from '../simulation/calendar/clock';
import { advanceGovernment, startGovernment, type GovContext } from '../simulation/government/state';
import { respondToCrisis } from '../simulation/government/state';
import { validateGovState } from '../simulation/government/validate';
import { ministryOwners } from '../simulation/government/cabinet';
import { MINISTRY_DEFS } from '../simulation/government/types';
import { CRISES, CRISIS_BY_ID, CRISIS_GAP_DAYS, applyEconomyDelta, ignoredEffect, ministerEffect, rollCrisis } from '../simulation/world/crises';
import {
  NO_CONFIDENCE_APPROVAL, OPPOSITION_ACTIONS, actionReady, advanceOpposition, governmentSupport, moveNoConfidence, popularityTarget, startOpposition, takeOppositionAction,
} from '../simulation/world/opposition';
import {
  TERM_DAYS, advanceTerm, carryPopularity, cycleDue, earlyTerm, firstTerm, incomeMonths, markHeld, monthlyDonations, nextElectionDayOf, rolloverMembers, windowOf,
} from '../simulation/world/term';
import { validateOpposition, validatePast, validateTerm } from '../simulation/world/validate';
import { START_ECONOMY } from '../simulation/government/economy';
import { ministerScore } from '../simulation/government/cabinet';

function makeCtx(seed: number): ElectionContext {
  const members = generateMembers(seed);
  const constituencies = generateConstituencies(seed);
  const assignments = autoAssign({}, members, constituencies);
  return {
    seed, day: 181, constituencies, members, assignments, rivals: generateRivals(seed),
    player: { name: 'Bharat Vikas Dal', abbreviation: 'BVD', color: '#ff9f1c', ideology: partyIdeology(members, assignments), popularity: 35 },
    campaign: emptyCampaign(),
  };
}

function ideologiesOf(ec: ElectionContext): GovContext['ideologies'] {
  const out: GovContext['ideologies'] = { [PLAYER_ID]: ec.player.ideology, IND: 'centrist-governance' };
  for (const r of ec.rivals) out[r.id] = r.ideology;
  return out;
}

function leaderGame(): GovContext {
  for (let seed = 1; seed < 400; seed++) {
    const ec = makeCtx(seed);
    const result = runElection(ec);
    let gov: Government | null = resolveElection(result, ec.rivals, ec.player, seed);
    if (!gov) {
      for (const b of standings(result, ec.rivals, ec.player)) {
        if (b.id === PLAYER_ID) continue;
        const r = formCoalition(result, ec.rivals, ec.player, seed, [b.id]);
        if (r.ok && r.government.playerRole === 'leader') { gov = r.government; break; }
      }
    }
    if (gov && gov.playerRole === 'leader') return { seed, government: gov, result, ideologies: ideologiesOf(ec), members: ec.members };
  }
  throw new Error('no leader game found');
}

/** A game where a rival forms the government and the player sits in opposition. */
function oppositionGame(): { ec: ElectionContext; gov: Government; ideologies: GovContext['ideologies'] } {
  for (let seed = 1; seed < 400; seed++) {
    const ec = makeCtx(seed);
    const result = runElection(ec);
    const gov = resolveElection(result, ec.rivals, ec.player, seed) ?? autoGovernment(result, ec.rivals, ec.player, seed, true);
    if (gov.playerRole === 'opposition') return { ec, gov, ideologies: ideologiesOf(ec) };
  }
  throw new Error('no opposition game found');
}

const gc = leaderGame();

describe('term calendar', () => {
  it('starts like Phase 3: campaign on day 91, election on day 181', () => {
    const t = firstTerm();
    expect(t).toEqual({ number: 1, campaignStartDay: 91, electionDay: 181, held: false, nextElectionDay: null });
    expect(windowOf(t)).toEqual({ start: 91, end: 181 });
    expect(nextElectionDayOf(t)).toBe(181);
    expect(daysUntilElection({ day: 1, minutes: 360 })).toBe(180);
    expect(daysUntilElection({ day: 181, minutes: 0 })).toBe(0);
    expect(daysUntilElection({ day: 500, minutes: 0 })).toBe(0);
  });
  it('schedules the next election five years after the last one was held', () => {
    const held = markHeld(firstTerm(), 181);
    expect(held.held).toBe(true);
    expect(held.nextElectionDay).toBe(181 + TERM_DAYS);
    expect(nextElectionDayOf(held)).toBe(181 + TERM_DAYS);
    expect(cycleDue(held, 181 + TERM_DAYS - 91)).toBe(false);
    expect(cycleDue(held, 181 + TERM_DAYS - 90)).toBe(true);
    expect(cycleDue(firstTerm(), 5000)).toBe(false);
    const next = advanceTerm(held);
    expect(next).toEqual({ number: 2, campaignStartDay: 181 + TERM_DAYS - 90, electionDay: 181 + TERM_DAYS, held: false, nextElectionDay: null });
  });
  it('early elections come sooner, never later', () => {
    const held = markHeld(firstTerm(), 181);
    const early = earlyTerm(held, 400);
    expect(early.number).toBe(2);
    expect(early.electionDay).toBe(445);
    expect(early.campaignStartDay).toBeLessThan(early.electionDay);
    expect(early.held).toBe(false);
    const open = advanceTerm(held);
    const sooner = earlyTerm(open, 1800);
    expect(sooner.number).toBe(2);
    expect(sooner.electionDay).toBeLessThanOrEqual(open.electionDay);
    expect(earlyTerm(firstTerm(), 170).electionDay).toBe(181); // already close: unchanged
  });
  it('the campaign window follows the term', () => {
    const w = { start: 2000, end: 2090 };
    expect(campaignOpen(1999, w)).toBe(false);
    expect(campaignOpen(2000, w)).toBe(true);
    expect(campaignOpen(2090, w)).toBe(false);
    const cs = generateConstituencies(3);
    const a = { C001: 'M001' };
    expect(holdRally(50, emptyCampaign(), 100, cs, a, 'C001', w).ok).toBe(false);
    expect(holdRally(50, emptyCampaign(), 2010, cs, a, 'C001', w).ok).toBe(true);
    expect(buyNationalAds(50, emptyCampaign(), 100, 2, w).ok).toBe(false);
    expect(buyNationalAds(50, emptyCampaign(), 2010, 2, w).ok).toBe(true);
    // default window is still the first election
    expect(holdRally(50, emptyCampaign(), 100, cs, a, 'C001').ok).toBe(true);
  });
  it('members age and settle between elections; the very old retire', () => {
    const ms = generateMembers(4);
    const old = { ...ms[0], age: 80, status: 'active' as const };
    const out = rolloverMembers([old, ...ms.slice(1)]);
    expect(out).toHaveLength(ms.length);
    expect(out[0].status).toBe('resigned');
    expect(out[1].age).toBe(ms[1].age + 5);
    for (const m of out) { expect(m.opposesLeadership).toBe(false); expect(m.loyalty).toBeGreaterThanOrEqual(0); expect(m.loyalty).toBeLessThanOrEqual(100); }
    expect(ms[0].age).not.toBe(80); // input is not mutated
  });
  it('popularity carries the record of the last term', () => {
    expect(carryPopularity(40, { approval: 70 }, null)).toBeGreaterThan(40);
    expect(carryPopularity(40, { approval: 20 }, null)).toBeLessThan(40);
    expect(carryPopularity(40, null, { standing: 80, rulingApproval: 30 })).toBeGreaterThan(40);
    expect(carryPopularity(40, null, null)).toBe(40);
  });
  it('donations only grow with popularity and power', () => {
    expect(monthlyDonations(50, false)).toBeGreaterThan(monthlyDonations(20, false));
    expect(monthlyDonations(30, true)).toBeGreaterThan(monthlyDonations(30, false));
    expect(incomeMonths(1, 29)).toBe(0);
    expect(incomeMonths(1, 31)).toBe(1);
    expect(incomeMonths(100, 50)).toBe(0);
  });
  it('rivals are unchanged in term 1 and drift in later terms; unpopular incumbents lose ground', () => {
    expect(generateRivals(5, 1)).toEqual(generateRivals(5));
    const t2 = generateRivals(5, 2);
    expect(t2.some((r, i) => r.strength !== generateRivals(5)[i].strength)).toBe(true);
    expect(generateRivals(5, 2)).toEqual(t2);
    const base = generateRivals(5, 2).find((r) => r.id === 'NPA')!.strength;
    const bad = generateRivals(5, 2, { id: 'NPA', approval: 15 }).find((r) => r.id === 'NPA')!.strength;
    const good = generateRivals(5, 2, { id: 'NPA', approval: 80 }).find((r) => r.id === 'NPA')!.strength;
    expect(bad).toBeLessThan(base);
    expect(good).toBeGreaterThanOrEqual(base);
    for (const r of generateRivals(5, 3, { id: 'JSM', approval: 0 })) { expect(r.strength).toBeGreaterThanOrEqual(0); expect(r.strength).toBeLessThanOrEqual(100); }
  });
});

describe('crises', () => {
  it('every crisis has three options, valid ministry ids and sensible numbers', () => {
    expect(CRISES.length).toBeGreaterThanOrEqual(8);
    const ids = new Set(MINISTRY_DEFS.map((m) => m.id));
    expect(new Set(CRISES.map((c) => c.id)).size).toBe(CRISES.length);
    for (const c of CRISES) {
      expect(c.options).toHaveLength(3);
      expect(ids.has(c.ministry)).toBe(true);
      expect(c.ignored.approval).toBeLessThan(0);
      for (const o of c.options) { expect(o.cost).toBeGreaterThanOrEqual(0); expect(Math.abs(o.approval)).toBeLessThan(10); }
      // the expensive answer should help more than doing nothing
      expect(c.options[0].approval).toBeGreaterThan(c.options[2].approval);
    }
  });
  it('rolls deterministically, respects the gap, and happens roughly one month in six', () => {
    expect(rollCrisis(7, 60, 0)).toBe(rollCrisis(7, 60, 0));
    expect(rollCrisis(7, 60, 30)).toBeNull(); // too soon after the last one
    let hits = 0;
    for (let m = 1; m <= 400; m++) if (rollCrisis(11, m * 30, -1e6) !== null) hits++;
    expect(hits).toBeGreaterThan(50);
    expect(hits).toBeLessThan(130);
    expect(CRISIS_GAP_DAYS).toBeGreaterThan(0);
  });
  it('economy nudges stay inside their limits', () => {
    const e = applyEconomyDelta({ ...START_ECONOMY, growth: 10.9, inflation: 1.1, unemployment: 19.9 }, { growth: 5, inflation: -5, unemployment: 5 });
    expect(e.growth).toBe(11); expect(e.inflation).toBe(1); expect(e.unemployment).toBe(20);
    expect(ignoredEffect(CRISIS_BY_ID.floods, START_ECONOMY).approval).toBeLessThan(0);
  });
  it('a strong minister helps, an empty chair hurts, a partner-held ministry is out of your hands', () => {
    const owners = ministryOwners(gc.government);
    const def = CRISIS_BY_ID.floods; // home affairs
    const strong = { ...gc.members[0], status: 'active' as const, leadership: 100, reputation: 100, experience: 40, loyalty: 100 };
    const weak = { ...gc.members[1], status: 'active' as const, leadership: 5, reputation: 5, experience: 0, loyalty: 5 };
    const mine = { ...owners, home: PLAYER_ID };
    expect(ministerScore(strong)).toBeGreaterThanOrEqual(70);
    expect(ministerEffect(def, { home: strong.id }, mine, [strong, weak], PLAYER_ID)).toBeGreaterThan(0);
    expect(ministerEffect(def, { home: weak.id }, mine, [strong, weak], PLAYER_ID)).toBeLessThan(0);
    expect(ministerEffect(def, {}, mine, [strong, weak], PLAYER_ID)).toBeLessThan(0);
    expect(ministerEffect(def, { home: strong.id }, { ...owners, home: 'NPA' }, [strong, weak], PLAYER_ID)).toBe(0);
  });
  it('a government meets crises over five years; months wait until each is handled or times out', () => {
    let s = startGovernment(gc.government, 181, 35);
    let day = 181;
    const seen: string[] = [];
    for (let i = 0; i < 400 && s.status === 'governing'; i++) {
      day += 30;
      const r = advanceGovernment(s, gc, day);
      s = r.state;
      if (s.crisis) {
        seen.push(s.crisis.id);
        expect(s.crisis.deadline).toBe(day + 30);
        // while the crisis is open nothing further happens, however long we wait (short of the deadline)
        const frozen = advanceGovernment(s, gc, day + 10);
        expect({ ...frozen.state, protests: s.protests }).toEqual(s); // crowds may still go home day by day
        expect(frozen.reports).toHaveLength(0);
        const reply = respondToCrisis(s, gc, 1, day);
        if (reply.ok) { s = reply.state; expect(s.crisis).toBeNull(); }
        else s = advanceGovernment(s, gc, s.crisis.deadline).state; // could not afford: let it lapse
      }
    }
    expect(seen.length).toBeGreaterThan(2);
    expect(s.crisisLog.length).toBeGreaterThan(0);
    expect(s.crisisLog.length).toBeLessThanOrEqual(20);
  });
  it('responding costs treasury money, shifts approval and clears the crisis; bad choices are refused', () => {
    let s = startGovernment(gc.government, 181, 35);
    s = { ...s, crisis: { id: 'floods', startDay: 200, deadline: 230 }, treasury: 10000 };
    expect(respondToCrisis({ ...s, crisis: null }, gc, 0, 200).ok).toBe(false);
    expect(respondToCrisis(s, gc, 7, 200).ok).toBe(false);
    expect(respondToCrisis({ ...s, treasury: 100 }, gc, 0, 200).ok).toBe(false);
    expect(respondToCrisis({ ...s, status: 'fallen' }, gc, 0, 200).ok).toBe(false);
    const r = respondToCrisis(s, gc, 0, 200);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.crisis).toBeNull();
      expect(r.state.treasury).toBe(10000 - CRISIS_BY_ID.floods.options[0].cost);
      expect(r.state.approval).toBeGreaterThan(s.approval - 3);
      expect(r.state.crisisLog[r.state.crisisLog.length - 1]).toMatchObject({ id: 'floods', choice: 0, day: 200 });
    }
    const free = respondToCrisis(s, gc, 2, 200);
    expect(free.ok && free.state.treasury === 10000).toBe(true);
    expect(free.ok && free.state.approval < s.approval).toBe(true);
  });
  it('an unanswered crisis lapses at its deadline and hurts', () => {
    let s = startGovernment(gc.government, 181, 35);
    s = { ...s, crisis: { id: 'epidemic', startDay: 181, deadline: 211 }, lastCrisisDay: 181 };
    const early = advanceGovernment(s, gc, 205);
    expect(early.state.crisis).not.toBeNull();
    expect(early.state.approval).toBe(s.approval);
    const late = advanceGovernment(s, gc, 215);
    expect(late.state.crisisLog[0]).toMatchObject({ id: 'epidemic', choice: null });
    expect(late.state.approval).toBeLessThan(s.approval);
    expect(late.state.history.some((h) => h.includes('unanswered'))).toBe(true);
  });
  it('validates crisis fields in a saved government', () => {
    const ids = new Set(gc.members.map((m) => m.id));
    const s = { ...startGovernment(gc.government, 181, 35), crisis: { id: 'floods' as const, startDay: 200, deadline: 230 }, crisisLog: [{ id: 'strike' as const, day: 100, choice: 1, approvalChange: 1 }] };
    expect(validateGovState(JSON.parse(JSON.stringify(s)), ids)).toEqual(s);
    expect(validateGovState({ ...s, crisis: { id: 'nope', startDay: 1, deadline: 2 } }, ids)).toBeNull();
    expect(validateGovState({ ...s, crisis: { id: 'floods', startDay: 5, deadline: 2 } }, ids)).toBeNull();
    expect(validateGovState({ ...s, crisisLog: [{ id: 'strike', day: 1, choice: 9, approvalChange: 0 }] }, ids)).toBeNull();
    expect(validateGovState({ ...s, lastCrisisDay: 'x' }, ids)).toBeNull();
    const { crisis: _c, ...missing } = s;
    expect(validateGovState(missing, ids)).toBeNull();
  });
});

describe('opposition', () => {
  const og = oppositionGame();
  const seats = runElection(og.ec).seats;
  const octx = { seed: og.ec.seed, government: og.gov, seats, ideologies: og.ideologies };

  it('starts in the middle with the ruling party fairly popular', () => {
    const s = startOpposition(181);
    expect(s.standing).toBe(50);
    expect(s.rulingApproval).toBeGreaterThan(50);
    expect(s.rulingFallen).toBe(false);
    expect(OPPOSITION_ACTIONS).toHaveLength(4);
  });
  it('actions cost party funds, have cooldowns, and are deterministic', () => {
    const s = startOpposition(181);
    const a = takeOppositionAction(s, 10, 3, 'press', 190);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.funds).toBe(9.5);
    expect(a.state.rulingApproval).toBeLessThan(s.rulingApproval);
    expect(takeOppositionAction(s, 10, 3, 'press', 190)).toEqual(a);
    expect(actionReady(a.state, 'press', 195)).toBe(10);
    expect(takeOppositionAction(a.state, 10, 3, 'press', 195).ok).toBe(false);
    expect(takeOppositionAction(a.state, 10, 3, 'press', 205).ok).toBe(true);
    expect(takeOppositionAction(s, 0.1, 3, 'grassroots', 190).ok).toBe(false);
    expect(takeOppositionAction({ ...s, rulingFallen: true }, 10, 3, 'press', 190).ok).toBe(false);
  });
  it('risky actions can win or backfire, depending on the day', () => {
    const outcomes = new Set<string>();
    for (let day = 200; day < 260; day++) {
      const r = takeOppositionAction(startOpposition(181), 50, 9, 'expose', day);
      if (r.ok) outcomes.add(r.state.standing > 50 ? 'win' : 'flop');
    }
    expect(outcomes.has('win')).toBe(true);
    expect(outcomes.has('flop')).toBe(true);
  });
  it('months pass deterministically and approval stays in range', () => {
    const a = advanceOpposition(startOpposition(181), 5, 181 + 30 * 100);
    const b = advanceOpposition(startOpposition(181), 5, 181 + 30 * 100);
    expect(a).toEqual(b);
    expect(a.reports).toHaveLength(100);
    expect(a.state.rulingApproval).toBeGreaterThanOrEqual(5);
    expect(a.state.rulingApproval).toBeLessThanOrEqual(95);
    expect(a.state.lastMonthDay).toBe(181 + 3000);
    expect(advanceOpposition(startOpposition(181), 5, 200).reports).toHaveLength(0);
  });
  it('popularity target rises with standing and falls with the ruling party\'s approval', () => {
    const s = startOpposition(1);
    expect(popularityTarget({ ...s, standing: 80 })).toBeGreaterThan(popularityTarget({ ...s, standing: 30 }));
    expect(popularityTarget({ ...s, rulingApproval: 20 })).toBeGreaterThan(popularityTarget({ ...s, rulingApproval: 80 }));
  });
  it('a no-confidence motion needs an unpopular government and respects its cooldown', () => {
    const s = startOpposition(181);
    const tooEarly = moveNoConfidence(s, octx, 200);
    expect(tooEarly.ok).toBe(false);
    const low = { ...s, rulingApproval: NO_CONFIDENCE_APPROVAL - 5 };
    const r = moveNoConfidence(low, octx, 200);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome.state.motionDay).toBe(200);
    expect(r.outcome.passed).toBe(r.outcome.support < 91);
    expect(r.outcome.state.rulingFallen).toBe(r.outcome.passed);
    if (!r.outcome.passed) {
      expect(r.outcome.state.standing).toBeLessThan(low.standing);
      expect(moveNoConfidence(r.outcome.state, octx, 230).ok).toBe(false); // cooling off
      expect(moveNoConfidence(r.outcome.state, octx, 261).ok).toBe(true);
    } else {
      expect(r.outcome.state.standing).toBeGreaterThan(low.standing);
      expect(moveNoConfidence(r.outcome.state, octx, 400).ok).toBe(false);
    }
  });
  it('a hated government loses MPs to rebellion and can fall; a loved one is safe', () => {
    const loved = governmentSupport(octx, 70, 300);
    const hated = governmentSupport(octx, 5, 300);
    expect(hated.support).toBeLessThanOrEqual(loved.support);
    expect(loved.own).toBe(hated.own);
    // Build a shaky majority and watch it collapse.
    const shaky = { seed: 1, government: { ...og.gov, partners: [] as string[] }, seats: { [og.gov.leaderId]: 95, [PLAYER_ID]: 85 }, ideologies: og.ideologies };
    expect(governmentSupport(shaky, 60, 10).support).toBe(95);
    expect(governmentSupport(shaky, 5, 10).support).toBeLessThan(91);
    const low = { ...startOpposition(1), rulingApproval: 5 };
    const m = moveNoConfidence(low, shaky, 100);
    expect(m.ok && m.outcome.passed).toBe(true);
  });
  it('validates saved opposition and term data', () => {
    const o = { ...startOpposition(181), lastUsed: { press: 190 }, motionDay: 200 };
    expect(validateOpposition(JSON.parse(JSON.stringify(o)))).toEqual(o);
    expect(validateOpposition({ ...o, standing: 150 })).toBeNull();
    expect(validateOpposition({ ...o, lastUsed: { magic: 3 } })).toBeNull();
    expect(validateOpposition({ ...o, lastMonthDay: 1 })).toBeNull();
    expect(validateOpposition({ ...o, history: [1] })).toBeNull();
    expect(validateOpposition(null)).toBeNull();
    const t = markHeld(firstTerm(), 181);
    expect(validateTerm(JSON.parse(JSON.stringify(t)))).toEqual(t);
    expect(validateTerm({ ...t, held: false })).toBeNull();
    expect(validateTerm({ ...firstTerm(), nextElectionDay: 5000 })).toBeNull();
    expect(validateTerm({ ...t, electionDay: 50, campaignStartDay: 60 })).toBeNull();
    expect(validateTerm({ ...t, number: 0 })).toBeNull();
    const past = [{ term: 1, day: 181, seats: { PLAYER: 50 }, voteShare: { PLAYER: 30.5 }, leaderId: 'NPA', playerRole: 'opposition' as const, early: false }];
    expect(validatePast(JSON.parse(JSON.stringify(past)))).toEqual(past);
    expect(validatePast([{ ...past[0], playerRole: 'king' }])).toBeNull();
    expect(validatePast([{ ...past[0], seats: { PLAYER: -1 } }])).toBeNull();
    expect(validatePast('x')).toBeNull();
  });
});

describe('a full second cycle', () => {
  it('a second election gives different luck, and the same inputs always give the same result', () => {
    const ec1 = makeCtx(21);
    const r1 = runElection(ec1);
    const ec2 = { ...makeCtx(21), seed: (21 ^ 0x5bd1e995) >>> 0, rivals: generateRivals(21, 2) };
    const r2 = runElection(ec2);
    expect(runElection(ec2)).toEqual(r2);
    expect(r2.seats).not.toEqual(r1.seats);
    expect(Object.values(r2.seats).reduce((a, b) => a + b, 0)).toBe(180);
  });
});
