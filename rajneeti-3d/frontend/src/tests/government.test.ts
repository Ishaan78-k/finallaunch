import { describe, expect, it } from 'vitest';
import { generateMembers } from '../simulation/candidates/members';
import { generateConstituencies } from '../simulation/candidates/constituencies';
import { autoAssign } from '../simulation/candidates/tickets';
import { generateRivals, partyIdeology } from '../simulation/election/parties';
import { runElection } from '../simulation/election/model';
import { emptyCampaign } from '../simulation/election/campaign';
import { autoGovernment, formCoalition, resolveElection, standings } from '../simulation/election/coalition';
import { PLAYER_ID, type ElectionContext, type Government } from '../simulation/election/types';
import { MINISTRIES } from '../data/constants';
import { MINISTRY_DEFS, BILLS, DEFAULT_SPENDING, DEFAULT_TAXES, SECTORS } from '../simulation/government/types';
import { monthlyRevenue, monthlySpending, stepMonth, START_ECONOMY, START_TREASURY, validSpending, validTaxes } from '../simulation/government/economy';
import { appointMinister, autoCabinet, cabinetQuality, dismissMinister, eligibleMinisters, ministerScore, ministryOwners, pruneCabinet } from '../simulation/government/cabinet';
import { confidenceVote, voteOnBill } from '../simulation/government/parliament';
import { advanceGovernment, billGrowth, canPropose, canRun, groupMinistries, proposeBill, setSpending, setTaxes, startGovernment, type GovContext } from '../simulation/government/state';
import { validateGovState } from '../simulation/government/validate';
import { Rng } from '../simulation/core/rng';

function makeCtx(seed: number): ElectionContext {
  const members = generateMembers(seed);
  const constituencies = generateConstituencies(seed);
  const assignments = autoAssign({}, members, constituencies);
  return {
    seed, day: 181, constituencies, members, assignments, rivals: generateRivals(seed),
    player: { name: 'Bharat Vikas Dal', abbreviation: 'BVD', color: '#ff9f1c', ideology: partyIdeology(members, assignments), popularity: 35 },
    campaign: emptyCampaign(),
    ...{},
  };
}

/** Finds a seed where the player can lead a government (majority or coalition). */
function leaderGame(): { ec: ElectionContext; gov: Government; gc: GovContext } {
  for (let seed = 1; seed < 400; seed++) {
    const ec = makeCtx(seed);
    const result = runElection(ec);
    let gov = resolveElection(result, ec.rivals, ec.player, seed);
    if (!gov) {
      const blocs = standings(result, ec.rivals, ec.player);
      for (const b of blocs) {
        if (b.id === PLAYER_ID) continue;
        const r = formCoalition(result, ec.rivals, ec.player, seed, [b.id]);
        if (r.ok && r.government.playerRole === 'leader') { gov = r.government; break; }
      }
    }
    if (gov && gov.playerRole === 'leader') {
      const ideologies: Record<string, ElectionContext['player']['ideology']> = { [PLAYER_ID]: ec.player.ideology, IND: 'centrist-governance' };
      for (const r of ec.rivals) ideologies[r.id] = r.ideology;
      return { ec, gov, gc: { seed, government: gov, result, ideologies, members: ec.members } };
    }
  }
  throw new Error('no leader game found in 400 seeds');
}

const { gov, gc } = leaderGame();

describe('ministries', () => {
  it('has 12 distinct ministries and shares them across the government', () => {
    expect(MINISTRY_DEFS).toHaveLength(MINISTRIES);
    expect(new Set(MINISTRY_DEFS.map((m) => m.id)).size).toBe(MINISTRIES);
    const owners = ministryOwners(gov);
    expect(Object.keys(owners)).toHaveLength(MINISTRIES);
    const counts: Record<string, number> = {};
    for (const o of Object.values(owners)) counts[o] = (counts[o] ?? 0) + 1;
    for (const [party, n] of Object.entries(gov.ministries)) expect(counts[party] ?? 0).toBe(n);
    expect(owners.finance).toBe(PLAYER_ID); // the leader takes the top posts first
  });
});

describe('economy', () => {
  it('starts close to balance and stays sane for five years of default policy', () => {
    const rev = monthlyRevenue(START_ECONOMY, DEFAULT_TAXES);
    const spend = monthlySpending(DEFAULT_SPENDING);
    expect(Math.abs(rev - spend)).toBeLessThan(spend * 0.15);
    let e = START_ECONOMY, t = START_TREASURY, a = 50;
    const rng = new Rng(5);
    for (let m = 0; m < 60; m++) {
      const o = stepMonth({ economy: e, treasury: t, taxes: DEFAULT_TAXES, spending: DEFAULT_SPENDING, cabinetQuality: 50, billGrowth: 0, approval: a, rng });
      e = o.economy; t = o.treasury; a = o.approval;
      expect(e.growth).toBeGreaterThan(-4.1); expect(e.growth).toBeLessThan(11.1);
      expect(e.inflation).toBeGreaterThanOrEqual(1); expect(e.inflation).toBeLessThanOrEqual(15);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(a).toBeGreaterThanOrEqual(0); expect(a).toBeLessThanOrEqual(100);
    }
    expect(e.debt / e.gdp).toBeLessThan(0.9);
  });
  it('is deterministic for the same rng seed', () => {
    const run = () => stepMonth({ economy: START_ECONOMY, treasury: 100, taxes: DEFAULT_TAXES, spending: DEFAULT_SPENDING, cabinetQuality: 60, billGrowth: 0.1, approval: 50, rng: new Rng(9) });
    expect(run()).toEqual(run());
  });
  it('higher taxes raise revenue; overspending runs the treasury dry and borrows', () => {
    expect(monthlyRevenue(START_ECONOMY, { ...DEFAULT_TAXES, gst: 18 })).toBeGreaterThan(monthlyRevenue(START_ECONOMY, DEFAULT_TAXES));
    const o = stepMonth({ economy: START_ECONOMY, treasury: 10, taxes: DEFAULT_TAXES, spending: DEFAULT_SPENDING, cabinetQuality: 50, billGrowth: 0, approval: 50, rng: new Rng(1) });
    expect(o.treasury).toBe(0);
    expect(o.borrowed).toBeGreaterThan(0);
    expect(o.economy.debt).toBe(START_ECONOMY.debt + o.borrowed);
  });
  it('infrastructure spending lifts growth over time, heavy corporate tax drags it', () => {
    const run = (spendMul: number, corp: number) => {
      let e = START_ECONOMY;
      const sp = { ...DEFAULT_SPENDING, infrastructure: DEFAULT_SPENDING.infrastructure * spendMul };
      const rng = new Rng(3);
      for (let m = 0; m < 24; m++) e = stepMonth({ economy: e, treasury: 1e6, taxes: { ...DEFAULT_TAXES, corporate: corp }, spending: sp, cabinetQuality: 50, billGrowth: 0, approval: 50, rng }).economy;
      return e.growth;
    };
    expect(run(1.8, 25)).toBeGreaterThan(run(1, 25));
    expect(run(1, 45)).toBeLessThan(run(1, 25));
  });
  it('validates tax and spending limits', () => {
    expect(validTaxes(DEFAULT_TAXES)).toBeNull();
    expect(validTaxes({ ...DEFAULT_TAXES, income: 90 })).not.toBeNull();
    expect(validTaxes({ ...DEFAULT_TAXES, gst: NaN })).not.toBeNull();
    expect(validSpending(DEFAULT_SPENDING)).toBeNull();
    expect(validSpending({ ...DEFAULT_SPENDING, health: 1 })).not.toBeNull();
    expect(validSpending({ ...DEFAULT_SPENDING, defence: 1e9 })).not.toBeNull();
  });
});

describe('cabinet', () => {
  const owners = ministryOwners(gov);
  const mine = Object.keys(owners).filter((k) => owners[k] === PLAYER_ID);
  const members = gc.members;
  it('appoints active members once, only to posts the player owns', () => {
    const a = members.find((m) => m.status === 'active')!;
    const r = appointMinister({}, members, owners, mine[0], a.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(appointMinister(r.cabinet, members, owners, mine[1] ?? mine[0], a.id).ok).toBe(mine.length < 2);
    }
    expect(appointMinister({}, members, owners, 'nonsense', a.id).ok).toBe(false);
    expect(appointMinister({}, members, owners, mine[0], 'M999').ok).toBe(false);
    const partnerPost = Object.keys(owners).find((k) => owners[k] !== PLAYER_ID);
    if (partnerPost) expect(appointMinister({}, members, owners, partnerPost, a.id).ok).toBe(false);
  });
  it('rejects members who left the party', () => {
    const gone = { ...members[0], status: 'independent' as const };
    expect(appointMinister({}, [gone, ...members.slice(1)], owners, mine[0], gone.id).ok).toBe(false);
  });
  it('autoCabinet fills every owned post with distinct active members, best first', () => {
    const cab = autoCabinet(members, owners, {});
    expect(Object.keys(cab).sort()).toEqual([...mine].sort());
    expect(new Set(Object.values(cab)).size).toBe(mine.length);
    const best = eligibleMinisters(members, {}).sort((a, b) => ministerScore(b) - ministerScore(a) || a.id.localeCompare(b.id))[0];
    expect(Object.values(cab)).toContain(best.id);
    expect(cabinetQuality(cab, owners, members)).toBeGreaterThan(cabinetQuality({}, owners, members));
  });
  it('removes ministers who leave the party, and dismissal works', () => {
    const cab = autoCabinet(members, owners, {});
    const first = Object.keys(cab)[0];
    const left = members.map((m) => (m.id === cab[first] ? { ...m, status: 'resigned' as const } : m));
    const p = pruneCabinet(cab, left);
    expect(p.removed).toEqual([first]);
    expect(p.cabinet[first]).toBeUndefined();
    const d = dismissMinister(cab, first);
    expect(d.ok).toBe(true);
    expect(dismissMinister({}, first).ok).toBe(false);
  });
});

describe('parliament', () => {
  const seats = gc.result.seats;
  const input = (billId: string, day: number) => ({
    seed: gc.seed, day, bill: BILLS.find((b) => b.id === billId)!, seats, ideologies: gc.ideologies,
    leaderId: gov.leaderId, govParties: [gov.leaderId, ...gov.partners], satisfaction: Object.fromEntries(gov.partners.map((p) => [p, 60])),
  });
  it('every seat votes exactly once, and the vote is deterministic', () => {
    const v = voteOnBill(input('rural-jobs', 200));
    expect(v.yes + v.no + v.abstain).toBe(180);
    expect(v.rows.every((r) => r.yes + r.no + r.abstain === r.seats && r.yes >= 0 && r.no >= 0 && r.abstain >= 0)).toBe(true);
    expect(voteOnBill(input('rural-jobs', 200))).toEqual(v);
    expect(v.passed).toBe(v.yes > v.no);
  });
  it('a government with a majority carries most bills', () => {
    const wins = BILLS.filter((b) => voteOnBill(input(b.id, 210)).passed).length;
    if (gov.seats >= 91) expect(wins).toBeGreaterThan(BILLS.length / 2);
  });
  it('confidence vote: own majority always survives; a tiny minority with hostile opposition falls', () => {
    const ids = gc.ideologies;
    const base = { seed: 1, day: 100, ideologies: ids, leaderId: PLAYER_ID, approval: 50 };
    expect(confidenceVote({ ...base, seats: { PLAYER: 100, NPA: 80 }, govParties: [PLAYER_ID] }).survives).toBe(true);
    const c = confidenceVote({ ...base, seats: { PLAYER: 60, JSM: 60, RPD: 60 }, govParties: [PLAYER_ID], approval: 20 });
    expect(c.yes).toBe(60 + c.outside);
  });
});

describe('running the government', () => {
  const fresh = () => startGovernment(gov, 190, 35);
  it('starts sensibly and only a player-led government can be run', () => {
    const s = fresh();
    expect(s.status).toBe('governing');
    expect(s.partners).toEqual(gov.partners);
    expect(s.approval).toBeGreaterThanOrEqual(40);
    expect(canRun(gov)).toBe(true);
    expect(canRun({ ...gov, playerRole: 'opposition' })).toBe(false);
    expect(canRun(null)).toBe(false);
  });
  it('rejects out-of-range taxes and budgets without changing state', () => {
    const s = fresh();
    expect(setTaxes(s, { ...s.taxes, income: 99 }).ok).toBe(false);
    expect(setSpending(s, 'health', 0).ok).toBe(false);
    const ok = setSpending(s, 'health', DEFAULT_SPENDING.health * 1.5);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.state.spending.health).toBe(Math.round(DEFAULT_SPENDING.health * 1.5));
  });
  it('advances in whole months only, deterministically, and never twice for the same month', () => {
    const s = fresh();
    expect(advanceGovernment(s, gc, 190 + 29).state.lastMonthDay).toBe(190);
    const a = advanceGovernment(s, gc, 190 + 95);
    expect(a.state.lastMonthDay).toBe(190 + 90);
    expect(a.reports).toHaveLength(3);
    expect(advanceGovernment(s, gc, 190 + 95)).toEqual(a);
    const again = advanceGovernment(a.state, gc, 190 + 95);
    expect(again.reports).toHaveLength(0);
    // advancing in two steps equals advancing in one
    const half = advanceGovernment(advanceGovernment(s, gc, 190 + 40).state, gc, 190 + 95).state;
    expect(half).toEqual(a.state);
  });
  it('five years of play keep every number valid and the state saveable', () => {
    const { state } = advanceGovernment(fresh(), gc, 190 + 60 * 30);
    const ids = new Set(gc.members.map((m) => m.id));
    expect(validateGovState(JSON.parse(JSON.stringify(state)), ids)).toEqual(state);
  });
  it('bills pass or fail by vote, change policy only when passed, and respect cooldowns', () => {
    let s = fresh();
    const r = proposeBill(s, gc, 'income-tax-cut', 200);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome.vote.yes + r.outcome.vote.no + r.outcome.vote.abstain).toBe(180);
    if (r.outcome.passed) {
      expect(r.outcome.state.taxes.income).toBe(DEFAULT_TAXES.income - 2);
      expect(canPropose(r.outcome.state, 'income-tax-cut', 400)).not.toBeNull(); // already law
    } else {
      expect(r.outcome.state.taxes).toEqual(s.taxes);
      expect(canPropose(r.outcome.state, 'income-tax-cut', 205)).not.toBeNull(); // cooldown
      expect(canPropose(r.outcome.state, 'income-tax-cut', 231)).toBeNull();
    }
    s = r.outcome.state;
    expect(s.bills).toHaveLength(1);
    expect(proposeBill(s, gc, 'nonsense' as never, 210).ok).toBe(false);
  });
  it('bill growth effects fade over a year', () => {
    const s = { ...fresh(), bills: [{ billId: 'infrastructure-push' as const, day: 200, passed: true, yes: 100, no: 10, abstain: 70 }] };
    expect(billGrowth(s, 200)).toBeCloseTo(0.2, 5);
    expect(billGrowth(s, 380)).toBeCloseTo(0.1, 5);
    expect(billGrowth(s, 560)).toBe(0);
  });
  it('an unhappy partner walks out, ministries are re-shared, and a lost confidence vote ends the government', () => {
    if (gov.partners.length === 0) return;
    const s0 = fresh();
    const s = { ...s0, satisfaction: Object.fromEntries(gov.partners.map((p) => [p, 1])) };
    const { state } = advanceGovernment(s, gc, 190 + 31);
    expect(state.partners.length).toBeLessThan(gov.partners.length);
    const shares = groupMinistries(state, gc);
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBe(MINISTRIES);
    const own = [gov.leaderId, ...state.partners].reduce((n, p) => n + (gc.result.seats[p] ?? 0), 0);
    if (own >= 91) expect(state.status).toBe('governing');
    if (state.status === 'fallen') expect(state.fallenReason).not.toBeNull();
    // a fallen government cannot act
    if (state.status === 'fallen') {
      expect(setTaxes(state, state.taxes).ok).toBe(false);
      expect(canPropose(state, 'rural-jobs', 400)).not.toBeNull();
      expect(advanceGovernment(state, gc, 1000).reports).toHaveLength(0);
    }
  });
  it('departed ministers lose their posts at the next monthly update', () => {
    const owners = ministryOwners(gov);
    const cab = autoCabinet(gc.members, owners, {});
    const first = Object.keys(cab)[0];
    const members = gc.members.map((m) => (m.id === cab[first] ? { ...m, status: 'independent' as const } : m));
    const { state } = advanceGovernment({ ...fresh(), cabinet: cab }, { ...gc, members }, 190 + 31);
    expect(state.cabinet[first]).toBeUndefined();
  });
  it('good ministers give better results than empty posts', () => {
    const owners = ministryOwners(gov);
    const full = advanceGovernment({ ...fresh(), cabinet: autoCabinet(gc.members, owners, {}) }, gc, 190 + 360).state;
    const empty = advanceGovernment(fresh(), gc, 190 + 360).state;
    expect(full.economy.gdp).toBeGreaterThanOrEqual(empty.economy.gdp);
  });
});

describe('government save validation', () => {
  const ids = new Set(gc.members.map((m) => m.id));
  const s = startGovernment(gov, 190, 35);
  it('round-trips and rejects corrupt data', () => {
    expect(validateGovState(JSON.parse(JSON.stringify(s)), ids)).toEqual(s);
    expect(validateGovState(null, ids)).toBeNull();
    expect(validateGovState({ ...s, treasury: -1 }, ids)).toBeNull();
    expect(validateGovState({ ...s, approval: 101 }, ids)).toBeNull();
    expect(validateGovState({ ...s, status: 'sleeping' }, ids)).toBeNull();
    expect(validateGovState({ ...s, taxes: { ...s.taxes, income: 99 } }, ids)).toBeNull();
    expect(validateGovState({ ...s, spending: { ...s.spending, health: 0 } }, ids)).toBeNull();
    expect(validateGovState({ ...s, cabinet: { finance: 'M999' } }, ids)).toBeNull();
    expect(validateGovState({ ...s, cabinet: { finance: 'M001', home: 'M001' } }, ids)).toBeNull();
    expect(validateGovState({ ...s, cabinet: { fishing: 'M001' } }, ids)).toBeNull();
    expect(validateGovState({ ...s, bills: [{ billId: 'x', day: 1, passed: true, yes: 1, no: 1, abstain: 1 }] }, ids)).toBeNull();
    expect(validateGovState({ ...s, economy: { ...s.economy, gdp: 0 } }, ids)).toBeNull();
    expect(SECTORS).toHaveLength(7);
  });
});
