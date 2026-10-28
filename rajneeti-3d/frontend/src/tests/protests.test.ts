import { describe, expect, it } from 'vitest';
import { buildElectionContext, useGameStore } from '../state/gameStore';
import { validateSave } from '../services/saveSchema';
import { generateMembers } from '../simulation/candidates/members';
import { generateConstituencies } from '../simulation/candidates/constituencies';
import { advanceGovernment, startGovernment } from '../simulation/government/state';
import { validateGovState } from '../simulation/government/validate';
import { MONTH_DAYS, type GovState } from '../simulation/government/types';
import {
  CAUSES, CAUSE_BY_ID, CAUSE_IDS, IGNORED_OPTION, POLICE, PROTEST_GAP_DAYS, PROTEST_WINDOW_DAYS, crowdAgents, decisionReaction, electionEffect,
  grievances, initialProtests, policeOutcome, promiseMet, protestChance, protestView, publicAnger, respondToProtest, rollProtest, settleProtests,
  type Protest, type PromiseRecord,
} from '../simulation/world/protests';
import { validateProtests } from '../simulation/world/validate';

const get = () => useGameStore.getState();

function playerLeads(seed: number): boolean {
  get().startNewGame({ name: 'Test', pronouns: 'they/them' }, { name: 'Test Party', abbreviation: 'TP', color: '#ff9f1c' });
  useGameStore.setState({ seed, members: generateMembers(seed), constituencies: generateConstituencies(seed), funds: 400 });
  get().autoAssignAll();
  get().jumpToDay(181);
  get().holdElection();
  if (get().election?.stage === 'hung') get().joinOpposition();
  return get().election?.government?.playerRole === 'leader';
}
let cached = 0;
function leaderSeed(): number {
  if (cached) return cached;
  for (let seed = 1; seed < 400; seed++) if (playerLeads(seed)) return (cached = seed);
  throw new Error('no leader game');
}
function governing(): GovState {
  playerLeads(leaderSeed());
  return get().government!;
}
const gov0 = (): GovState => governing();
const withProtest = (s: GovState, over: Partial<Protest> = {}): GovState => ({
  ...s, protests: { ...s.protests, active: { cause: 'jobs', startDay: 200, deadline: 221, size: 20000, intensity: 50, status: 'open', response: null, police: null, outcome: null, endDay: null, ...over } },
});

describe('protest data', () => {
  it('every cause has three options, signs and a banner; costs are non-negative', () => {
    expect(CAUSES).toHaveLength(7);
    for (const c of CAUSES) {
      expect(c.options).toHaveLength(3);
      expect(c.signs.length).toBeGreaterThanOrEqual(4);
      expect(c.banner.length).toBeGreaterThan(0);
      for (const o of c.options) expect(o.cost).toBeGreaterThanOrEqual(0);
      expect(c.options[2].intensity).toBeGreaterThan(0); // rejecting angers the crowd
      expect(c.options[0].intensity).toBeLessThan(0);
    }
    expect(POLICE.map((p) => p.force)).toEqual([0, 0.3, 0.7, 1]);
  });
});

describe('public anger', () => {
  it('rises with unemployment, prices and falling approval, and stays in range', () => {
    const s = gov0();
    const calm = publicAnger(s, 200);
    const bad = publicAnger({ ...s, approval: 15, economy: { ...s.economy, unemployment: 15, inflation: 13 } }, 200);
    expect(bad.index).toBeGreaterThan(calm.index);
    expect(bad.index).toBeLessThanOrEqual(100);
    expect(calm.index).toBeGreaterThanOrEqual(0);
    for (const id of CAUSE_IDS) { expect(bad.grievances[id]).toBeGreaterThanOrEqual(0); expect(bad.grievances[id]).toBeLessThanOrEqual(1); }
    expect(['jobs', 'prices', 'political']).toContain(bad.top);
  });
  it('high taxes and starved sectors create their own grievances; a law lowers corruption anger', () => {
    const s = gov0();
    const g = grievances({ ...s, taxes: { income: 18, corporate: 25, gst: 18 }, spending: { ...s.spending, agriculture: 200, health: 200 } }, 200);
    expect(g.tax).toBeGreaterThan(0.5);
    expect(g.farm).toBeGreaterThan(0.5);
    expect(g.services).toBeGreaterThan(0.5);
    const law = grievances({ ...s, bills: [{ billId: 'anti-corruption', day: 1, passed: true, yes: 100, no: 50, abstain: 30 }] }, 200);
    expect(law.corruption).toBeLessThan(grievances(s, 200).corruption);
  });
  it('chance grows with anger and stays below 1', () => {
    expect(protestChance(0)).toBeLessThan(protestChance(50));
    expect(protestChance(50)).toBeLessThan(protestChance(100));
    expect(protestChance(100)).toBeLessThanOrEqual(0.6);
  });
});

describe('rolling protests', () => {
  it('is deterministic, respects the gap and never starts a second protest', () => {
    const s = { ...gov0(), approval: 10, economy: { ...gov0().economy, unemployment: 16, inflation: 14 } };
    let found: { day: number; p: Protest } | null = null;
    for (let day = 300; day < 3000 && !found; day += MONTH_DAYS) {
      const p = rollProtest(7, day, day, s);
      if (p) found = { day, p };
    }
    expect(found).not.toBeNull();
    expect(rollProtest(7, found!.day, found!.day, s)).toEqual(found!.p);
    expect(found!.p.deadline).toBe(found!.day + PROTEST_WINDOW_DAYS);
    expect(found!.p.size).toBeGreaterThan(0);
    expect(found!.p.status).toBe('open');
    const recent = { ...s, protests: { ...s.protests, lastProtestDay: found!.day - (PROTEST_GAP_DAYS - 1) } };
    expect(rollProtest(7, found!.day, found!.day, recent)).toBeNull();
    expect(rollProtest(7, found!.day, found!.day, withProtest(s))).toBeNull();
    expect(rollProtest(7, found!.day, found!.day, { ...s, status: 'fallen' })).toBeNull();
  });
  it('a bad economy brings more protests than a good one over five years', () => {
    const base = gov0();
    const count = (s: GovState): number => {
      let n = 0;
      let st = s;
      for (let day = s.startDay + 30; day < s.startDay + 1800; day += 30) {
        const p = rollProtest(3, day, day, st);
        if (p) { n++; st = { ...st, protests: { ...st.protests, lastProtestDay: day } }; }
      }
      return n;
    };
    const good = count({ ...base, approval: 70, economy: { ...base.economy, unemployment: 4, inflation: 4 } });
    const bad = count({ ...base, approval: 15, economy: { ...base.economy, unemployment: 15, inflation: 13 } });
    expect(bad).toBeGreaterThan(good);
  });
  it('a running government meets protests over five years and keeps its protest data valid', () => {
    const base = gov0();
    let s = base;
    let seen = 0;
    for (let i = 0; i < 60 && s.status === 'governing'; i++) {
      get().skipDays(30);
      s = get().government!;
      if (s.crisis) get().respond(1);
      if (get().government!.protests.active?.status === 'open') { seen++; get().respondProtest(1, 'standard'); }
      s = get().government!;
    }
    expect(seen).toBeGreaterThan(0);
    expect(s.protests.log.length).toBeLessThanOrEqual(20);
    expect(validateProtests(JSON.parse(JSON.stringify(s.protests)))).not.toBeNull();
  });
});

describe('police simulation', () => {
  it('is deterministic and numbers are never negative', () => {
    for (const p of POLICE) {
      const a = policeOutcome(5, 200, 30000, 70, p.id, 50);
      expect(policeOutcome(5, 200, 30000, 70, p.id, 50)).toEqual(a);
      expect(a.injuries).toBeGreaterThanOrEqual(0);
      expect(a.arrests).toBeGreaterThanOrEqual(0);
      expect(a.damage).toBeGreaterThanOrEqual(0);
      expect(a.unrest).toBeGreaterThanOrEqual(0);
    }
  });
  it('angry crowds clash more often, and more force means more injuries when they do', () => {
    const rate = (inten: number, level: 'restraint' | 'riot'): number => {
      let n = 0;
      for (let d = 1; d <= 400; d++) if (policeOutcome(9, d, 30000, inten, level, 50).outcome === 'clash') n++;
      return n / 400;
    };
    expect(rate(90, 'restraint')).toBeGreaterThan(rate(10, 'restraint'));
    expect(rate(80, 'riot')).toBeGreaterThan(rate(80, 'restraint'));
    let soft = -1; let hard = -1;
    for (let d = 1; d <= 400 && (soft < 0 || hard < 0); d++) {
      const a = policeOutcome(9, d, 30000, 95, 'restraint', 50);
      const b = policeOutcome(9, d, 30000, 95, 'riot', 50);
      if (soft < 0 && a.outcome === 'clash') soft = a.injuries;
      if (hard < 0 && b.outcome === 'clash') hard = b.injuries;
    }
    expect(hard).toBeGreaterThan(soft);
  });
  it('heavy force on a calm crowd is heavy-handed; low public trust makes clashes likelier', () => {
    let found = false;
    for (let d = 1; d <= 100 && !found; d++) {
      const r = policeOutcome(2, d, 5000, 5, 'heavy', 50);
      if (r.outcome === 'peaceful') { expect(r.approval).toBeLessThan(0); expect(r.trust).toBeLessThan(0); found = true; }
    }
    expect(found).toBe(true);
    const clashes = (trust: number): number => { let n = 0; for (let d = 1; d <= 400; d++) if (policeOutcome(4, d, 20000, 50, 'standard', trust).outcome === 'clash') n++; return n; };
    expect(clashes(5)).toBeGreaterThan(clashes(95));
  });
});

describe('answering a protest', () => {
  it('a concession costs treasury money, calms the crowd and sets the protest to disperse', () => {
    const s = withProtest(gov0());
    const r = respondToProtest(s, 1, 0, 'standard', 205);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.treasury).toBe(s.treasury - 2500 - 60);
    expect(r.state.protests.active?.status).toBe('dispersing');
    expect(r.state.protests.active?.intensity).toBe(5);
    expect(r.state.protests.active?.police).toBe('standard');
    expect(r.state.protests.active?.endDay).toBe(208);
    expect(r.state.economy.unemployment).toBeLessThan(s.economy.unemployment);
    expect(r.state.protests.log[r.state.protests.log.length - 1]).toMatchObject({ cause: 'jobs', day: 205, choice: 0, police: 'standard' });
    expect(['cheer']).toContain(r.reaction);
    expect(r.state.approval).toBeGreaterThan(s.approval - 3);
  });
  it('rejecting angers the crowd and costs approval and unrest', () => {
    const s = withProtest(gov0());
    const r = respondToProtest(s, 1, 2, 'restraint', 205);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.protests.active?.intensity).toBe(65);
    expect(r.state.approval).toBeLessThan(s.approval);
    expect(r.state.protests.unrest).toBeGreaterThan(s.protests.unrest);
    expect(['anger', 'clash']).toContain(r.reaction);
  });
  it('a promise records a target and deadline; an unaffordable or invalid answer is refused', () => {
    const s = withProtest(gov0());
    const r = respondToProtest(s, 1, 1, 'restraint', 205);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.state.protests.promises[0];
    expect(p).toMatchObject({ cause: 'jobs', kind: 'unemployment-below', status: 'pending', madeDay: 205, deadline: 325 });
    expect(p.target).toBeLessThan(s.economy.unemployment);
    expect(respondToProtest(s, 1, 0, 'riot', 205).ok).toBe(true);
    expect(respondToProtest({ ...s, treasury: 100 }, 1, 0, 'standard', 205).ok).toBe(false);
    expect(respondToProtest(s, 1, 7, 'standard', 205).ok).toBe(false);
    expect(respondToProtest(s, 1, 0, 'nuclear' as never, 205).ok).toBe(false);
    expect(respondToProtest({ ...s, protests: { ...s.protests, active: null } }, 1, 0, 'standard', 205).ok).toBe(false);
    expect(respondToProtest({ ...s, status: 'fallen' }, 1, 0, 'standard', 205).ok).toBe(false);
    expect(r.state.protests.active && respondToProtest(r.state, 1, 0, 'standard', 206).ok).toBe(false); // already answered
  });
  it('tax concessions change the tax rates inside their limits', () => {
    const s = withProtest(gov0(), { cause: 'tax' });
    const r = respondToProtest(s, 1, 0, 'restraint', 205);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.state.taxes.income).toBe(s.taxes.income - 1); expect(r.state.taxes.gst).toBe(s.taxes.gst - 1); }
  });
});

describe('deadlines and promises', () => {
  it('an unanswered protest lapses at its deadline, with a standard police response', () => {
    const s = withProtest(gov0());
    const before = settleProtests(s, 1, 220);
    expect(before.state).toBe(s);
    const late = settleProtests(s, 1, 221);
    expect(late.state.protests.active?.status).toBe('dispersing');
    expect(late.state.protests.log[0]).toMatchObject({ cause: 'jobs', choice: null, police: 'standard' });
    expect(late.state.approval).toBeLessThan(s.approval);
    expect(late.events.length).toBe(1);
    const gone = settleProtests(late.state, 1, 230);
    expect(gone.state.protests.active).toBeNull();
    expect(IGNORED_OPTION.approval).toBeLessThan(0);
  });
  it('a promise only counts on the day it falls due: kept helps, broken hurts', () => {
    const s0 = gov0();
    const p: PromiseRecord = { id: 'P1', cause: 'jobs', kind: 'unemployment-below', key: null, target: 6, text: 'Bring unemployment to 6% or lower', madeDay: 200, deadline: 320, status: 'pending' };
    const base: GovState = { ...s0, protests: { ...s0.protests, promises: [p] } };
    const kept = { ...base, economy: { ...base.economy, unemployment: 5.5 } };
    const broken = { ...base, economy: { ...base.economy, unemployment: 8 } };
    expect(promiseMet(p, kept)).toBe(true);
    expect(promiseMet(p, broken)).toBe(false);
    expect(settleProtests(kept, 1, 319).state).toBe(kept); // not due yet
    const k = settleProtests(kept, 1, 320);
    expect(k.state.protests.promises[0].status).toBe('kept');
    expect(k.state.approval).toBeGreaterThan(kept.approval);
    const b = settleProtests(broken, 1, 330);
    expect(b.state.protests.promises[0].status).toBe('broken');
    expect(b.state.approval).toBeLessThan(broken.approval);
    expect(b.state.protests.unrest).toBeGreaterThan(0);
    expect(grievances(b.state, 331).political).toBeGreaterThan(grievances(broken, 331).political);
  });
  it('every promise kind can be checked', () => {
    const s = gov0();
    const mk = (kind: PromiseRecord['kind'], key: string | null, target: number): PromiseRecord => ({ id: 'x', cause: 'jobs', kind, key, target, text: '', madeDay: 1, deadline: 2, status: 'pending' });
    expect(promiseMet(mk('inflation-below', null, 99), s)).toBe(true);
    expect(promiseMet(mk('tax-at-most', 'gst', 1), s)).toBe(false);
    expect(promiseMet(mk('spend-at-least', 'health', 1), s)).toBe(true);
    expect(promiseMet(mk('bill-passed', 'rural-jobs', 1), s)).toBe(false);
    expect(promiseMet(mk('approval-at-least', null, 0), s)).toBe(true);
  });
});

describe('election consequences', () => {
  it('kept promises help, broken promises and unrest hurt, and the effect is bounded', () => {
    const s = gov0();
    const prom = (status: PromiseRecord['status'], i: number): PromiseRecord => ({ id: `P${i}`, cause: 'jobs', kind: 'approval-at-least', key: null, target: 1, text: '', madeDay: 1, deadline: 2, status });
    expect(electionEffect(null)).toBe(0);
    expect(electionEffect(s)).toBe(0);
    expect(electionEffect({ ...s, protests: { ...s.protests, promises: [prom('kept', 1), prom('kept', 2)] } })).toBeGreaterThan(0);
    expect(electionEffect({ ...s, protests: { ...s.protests, promises: [prom('broken', 1)] } })).toBeLessThan(0);
    expect(electionEffect({ ...s, protests: { ...s.protests, unrest: 60 } })).toBeLessThan(0);
    expect(electionEffect({ ...s, protests: { ...s.protests, unrest: 100, promises: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => prom('broken', i)) } })).toBe(-12);
    expect(electionEffect({ ...s, protests: { ...s.protests, promises: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => prom('kept', i)) } })).toBe(3);
  });
  it('the election context lowers the party popularity when the government has stirred unrest, and raises it for kept promises', () => {
    playerLeads(leaderSeed());
    const pop = get().popularity;
    const g = get().government!;
    const base = buildElectionContext(get()).player.popularity;
    expect(base).toBe(pop);
    useGameStore.setState({ government: { ...g, protests: { ...g.protests, unrest: 60 } } });
    expect(buildElectionContext(get()).player.popularity).toBeLessThan(pop);
    expect(get().popularity).toBe(pop); // only the vote is affected, not the stored popularity
    const kept: PromiseRecord = { id: 'K', cause: 'jobs', kind: 'approval-at-least', key: null, target: 1, text: '', madeDay: 1, deadline: 2, status: 'kept' };
    useGameStore.setState({ government: { ...g, protests: { ...g.protests, promises: [kept, { ...kept, id: 'K2' }] } } });
    expect(buildElectionContext(get()).player.popularity).toBeGreaterThan(pop);
  });
});

describe('crowd reactions to decisions', () => {
  it('suits the cause: tax cuts please tax protesters, a GST hike angers them', () => {
    expect(decisionReaction('tax', { kind: 'tax', key: 'gst', delta: -1 }).reaction).toBe('cheer');
    expect(decisionReaction('tax', { kind: 'tax', key: 'gst', delta: 1 })).toEqual({ reaction: 'anger', intensity: 8 });
    expect(decisionReaction('jobs', { kind: 'bill', id: 'rural-jobs', passed: true }).reaction).toBe('cheer');
    expect(decisionReaction('jobs', { kind: 'bill', id: 'labour-reform', passed: true }).reaction).toBe('anger');
    expect(decisionReaction('jobs', { kind: 'bill', id: 'rural-jobs', passed: false }).reaction).toBe('anger');
    expect(decisionReaction('farm', { kind: 'spend', sector: 'agriculture', delta: 50 }).reaction).toBe('cheer');
    expect(decisionReaction('farm', { kind: 'spend', sector: 'agriculture', delta: -50 }).reaction).toBe('anger');
    expect(decisionReaction('farm', { kind: 'spend', sector: 'defence', delta: -50 }).reaction).toBeNull();
    expect(decisionReaction('prices', { kind: 'tax', key: 'income', delta: -1 }).reaction).toBeNull();
  });
  it('the store changes the open crowd\'s mood and signals the 3D scene', () => {
    playerLeads(leaderSeed());
    const g = withProtest(get().government!, { cause: 'tax', intensity: 50 });
    useGameStore.setState({ government: g, crowdReaction: null });
    const gst = g.taxes.gst;
    get().setTax('gst', gst - 1);
    expect(get().government!.protests.active!.intensity).toBe(44);
    expect(get().crowdReaction).toMatchObject({ seq: 1, kind: 'cheer' });
    get().setTax('gst', gst + 1);
    expect(get().government!.protests.active!.intensity).toBe(52);
    expect(get().crowdReaction).toMatchObject({ seq: 2, kind: 'anger' });
    get().setTax('corporate', get().government!.taxes.corporate + 1);
    expect(get().crowdReaction!.seq).toBe(3);
  });
  it('no reaction when nobody is outside', () => {
    playerLeads(leaderSeed());
    useGameStore.setState({ crowdReaction: null });
    get().setTax('gst', get().government!.taxes.gst - 1);
    expect(get().crowdReaction).toBeNull();
  });
});

describe('3D view data', () => {
  it('describes the crowd for the scene', () => {
    const s = gov0();
    expect(protestView(null)).toBeNull();
    expect(protestView(s)).toBeNull();
    const calm = protestView(withProtest(s, { intensity: 20 }))!;
    expect(calm).toMatchObject({ cause: 'jobs', mood: 'calm', police: 'restraint', open: true, key: 'jobs:200' });
    expect(calm.signs.length).toBeGreaterThanOrEqual(4);
    expect(protestView(withProtest(s, { intensity: 50 }))!.mood).toBe('angry');
    expect(protestView(withProtest(s, { intensity: 90 }))!.mood).toBe('riot');
    expect(protestView(withProtest(s, { status: 'dispersing', police: 'heavy', outcome: 'clash', endDay: 210 }))).toMatchObject({ mood: 'clash', police: 'heavy', open: false });
    expect(protestView(withProtest(s, { status: 'dispersing', police: 'standard', outcome: 'peaceful', endDay: 210 }))!.mood).toBe('dispersing');
    expect(CAUSE_BY_ID.jobs.banner).toBe(calm.banner);
  });
  it('crowd size scales with the protest but stays capped for slow devices', () => {
    expect(crowdAgents(0, 80)).toBe(12);
    expect(crowdAgents(2000, 80)).toBeGreaterThan(crowdAgents(300, 80));
    expect(crowdAgents(120000, 36)).toBe(36);
    expect(crowdAgents(120000, 150)).toBe(150);
    expect(crowdAgents(120000, 80)).toBe(80);
  });
});

describe('save system', () => {
  it('protest state round-trips through a save and corrupt data is rejected', () => {
    playerLeads(leaderSeed());
    let g = withProtest(get().government!);
    const r = respondToProtest(g, get().seed, 1, 'standard', 210);
    if (r.ok) g = r.state;
    useGameStore.setState({ government: g });
    const data = JSON.parse(JSON.stringify(get().toSaveData()));
    const back = validateSave(data);
    expect(back).not.toBeNull();
    expect(back!.government!.protests).toEqual(g.protests);
    const ids = new Set(get().members.map((m) => m.id));
    expect(validateGovState(data.government, ids)).not.toBeNull();
    const bad = (patch: Record<string, unknown>) => validateGovState({ ...data.government, protests: { ...data.government.protests, ...patch } }, ids);
    expect(bad({ unrest: 101 })).toBeNull();
    expect(bad({ policeTrust: -1 })).toBeNull();
    expect(bad({ log: [{ cause: 'nope' }] })).toBeNull();
    expect(bad({ promises: [{ id: 'a' }] })).toBeNull();
    expect(bad({ active: { ...data.government.protests.active, cause: 'xx' } })).toBeNull();
    expect(bad({ active: { ...data.government.protests.active, intensity: 500 } })).toBeNull();
    expect(bad({ active: { ...data.government.protests.active, status: 'open' } })).toBeNull(); // open crowds have not met police yet
    expect(validateGovState({ ...data.government, protests: undefined }, ids)).toBeNull();
    expect(validateProtests(initialProtests(5))).not.toBeNull();
    expect(validateSave({ ...data, version: 5 })).toBeNull();
  });
  it('a new government starts with an empty protest record', () => {
    const s = gov0();
    const fresh = startGovernment(get().election!.government!, 400, 40);
    expect(fresh.protests).toEqual(initialProtests(400));
    expect(s.protests.active).toBeNull();
    void advanceGovernment;
  });
});
