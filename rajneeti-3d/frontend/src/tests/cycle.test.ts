import { describe, expect, it } from 'vitest';
import { useGameStore } from '../state/gameStore';
import { validateSave } from '../services/saveSchema';
import { generateMembers } from '../simulation/candidates/members';
import { generateConstituencies } from '../simulation/candidates/constituencies';

const get = () => useGameStore.getState();

function setup(seed: number): void {
  get().startNewGame({ name: 'Test', pronouns: 'they/them' }, { name: 'Test Party', abbreviation: 'TP', color: '#ff9f1c' });
  useGameStore.setState({ seed, members: generateMembers(seed), constituencies: generateConstituencies(seed), funds: 400 });
  get().autoAssignAll();
}

function roundTrips(): void {
  const data = JSON.parse(JSON.stringify(get().toSaveData()));
  expect(validateSave(data)).not.toBeNull();
}

/** Plays the first election and settles the government. Returns the player's role. */
function firstElection(seed: number): string {
  setup(seed);
  get().jumpToDay(181);
  get().holdElection();
  const e = get().election!;
  if (e.stage === 'hung') get().joinOpposition();
  roundTrips();
  return get().election!.government!.playerRole;
}

function findSeed(role: string): number {
  for (let seed = 1; seed < 300; seed++) if (firstElection(seed) === role) return seed;
  throw new Error(`no ${role} game in 300 seeds`);
}

const seedCache: Record<string, number> = {};
function find(role: string): number {
  if (!(role in seedCache)) seedCache[role] = findSeed(role);
  return seedCache[role];
}

describe('election cycles in the store', () => {
  it('holding the first election records it and schedules the next one', () => {
    firstElection(find('leader'));
    const s = get();
    expect(s.term.held).toBe(true);
    expect(s.term.nextElectionDay).toBe(181 + 1800);
    expect(s.pastElections).toHaveLength(1);
    expect(s.pastElections[0].playerRole).toBe('leader');
    get().holdElection(); // a second attempt does nothing
    expect(get().pastElections).toHaveLength(1);
    get().rallyAt('C001'); // campaigning is over
    expect(get().campaign.totalSpent).toBe(0);
  });

  it('a governing player meets crises, runs five years, and faces a second election', () => {
    firstElection(find('leader'));
    let crises = 0;
    for (let i = 0; i < 400 && get().term.number === 1; i++) {
      get().skipDays(30);
      const g = get().government!;
      if (g.status === 'fallen') break;
      if (g.crisis) { crises++; get().respond(2); if (get().government!.crisis) get().skipDays(31); }
      roundTrips();
    }
    expect(crises).toBeGreaterThan(0);
    if (get().government!.status === 'fallen') { get().callEarlyElection(); }
    expect(get().term.number).toBe(2);
    expect(get().term.held).toBe(false);
    expect(get().assignments).toEqual({});
    expect(get().campaign.totalSpent).toBe(0);
    expect(get().election).not.toBeNull(); // the old result stays visible until the new vote
    roundTrips();
    get().autoAssignAll();
    get().rallyAt('C001');
    get().jumpToDay(get().term.campaignStartDay);
    get().rallyAt('C001');
    get().jumpToDay(get().term.electionDay);
    get().holdElection();
    const s = get();
    expect(s.term.held).toBe(true);
    expect(s.pastElections).toHaveLength(2);
    expect(s.objectives['second-election']).toBe(true);
    expect(s.funds).toBeGreaterThan(0);
    roundTrips();
  });

  it('an opposition player takes actions, moves a motion and forces an early election', () => {
    firstElection(find('opposition'));
    expect(get().opposition).not.toBeNull();
    expect(get().government).toBeNull();
    const funds = get().funds;
    get().oppose('press');
    expect(get().funds).toBeLessThan(funds);
    roundTrips();
    get().noConfidence(); // too early: ruling approval is high
    expect(get().opposition!.motionDay).toBeNull();
    get().skipDays(30);
    useGameStore.setState({ opposition: { ...get().opposition!, rulingApproval: 4 } });
    get().noConfidence();
    expect(get().opposition!.motionDay).not.toBeNull();
    roundTrips();
    if (get().opposition!.rulingFallen) {
      const day = get().clock.day;
      get().callEarlyElection();
      const t = get().term;
      expect(t.number).toBe(2);
      expect(t.electionDay).toBeLessThanOrEqual(day + 45);
      expect(get().assignments).toEqual({});
      roundTrips();
    } else {
      get().callEarlyElection(); // government has not fallen: refused
      expect(get().term.number).toBe(1);
    }
  });

  it('a long stretch in opposition rolls into the next campaign and keeps funds flowing', () => {
    firstElection(find('opposition'));
    const before = get().funds;
    for (let i = 0; i < 400 && get().term.number === 1; i++) get().skipDays(365);
    expect(get().term.number).toBe(2);
    expect(get().funds).toBeGreaterThan(before);
    expect(get().popularity).toBeGreaterThanOrEqual(5);
    expect(get().popularity).toBeLessThanOrEqual(90);
    roundTrips();
  });

  it('saves from older versions are refused', () => {
    firstElection(find('leader'));
    const data = JSON.parse(JSON.stringify(get().toSaveData()));
    expect(validateSave({ ...data, version: 4 })).toBeNull();
    expect(validateSave({ ...data, term: { ...data.term, held: false, nextElectionDay: null } })).toBeNull(); // election record disagrees with the term
    expect(validateSave({ ...data, pastElections: [] })).toBeNull();
    const { term: _t, ...noTerm } = data;
    expect(validateSave(noTerm)).toBeNull();
    expect(validateSave({ ...data, opposition: { startDay: 1 } })).toBeNull();
  });
});
