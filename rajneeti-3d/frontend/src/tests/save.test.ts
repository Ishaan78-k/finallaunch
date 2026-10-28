import { describe, expect, it } from 'vitest';
import { validateSave, type SaveData } from '../services/saveSchema';
import { SAVE_VERSION } from '../data/constants';
import { generateMembers } from '../simulation/candidates/members';
import { emptyCampaign } from '../simulation/election/campaign';
import { firstTerm } from '../simulation/world/term';

const good: SaveData = {
  version: SAVE_VERSION,
  savedAt: 1,
  player: { name: 'A', pronouns: 'they/them' },
  party: { name: 'P', abbreviation: 'PP', color: '#fff' },
  clock: { day: 3, minutes: 600 },
  funds: 50,
  popularity: 35,
  position: { x: 1, z: 2, rotY: 0 },
  objectives: { 'enter-hq': true },
  seed: 7,
  members: generateMembers(7),
  assignments: { C001: 'M001' },
  log: ['hello'],
  campaign: emptyCampaign(),
  election: null,
  government: null,
  term: firstTerm(),
  pastElections: [],
  opposition: null,
  incomeDay: 1,
};

describe('save validation', () => {
  it('accepts a valid save and round-trips through JSON', () => {
    expect(validateSave(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });
  it('rejects wrong versions, bad types and impossible values', () => {
    expect(validateSave(null)).toBeNull();
    expect(validateSave({ ...good, version: 99 })).toBeNull();
    expect(validateSave({ ...good, funds: -5 })).toBeNull();
    expect(validateSave({ ...good, popularity: 140 })).toBeNull();
    expect(validateSave({ ...good, clock: { day: 0, minutes: 10 } })).toBeNull();
    expect(validateSave({ ...good, position: { x: NaN, z: 0, rotY: 0 } })).toBeNull();
    expect(validateSave({ ...good, objectives: { a: 'yes' } })).toBeNull();
    expect(validateSave({ ...good, members: good.members.slice(1) })).toBeNull();
    expect(validateSave({ ...good, assignments: { C001: 'M001', C002: 'M001' } })).toBeNull();
    expect(validateSave({ ...good, assignments: { C999: 'M001' } })).toBeNull();
    expect(validateSave({ ...good, assignments: { C001: 'M999' } })).toBeNull();
    expect(validateSave({ ...good, campaign: { nationalSpend: -1, totalSpent: 0, local: {} } })).toBeNull();
    expect(validateSave({ ...good, election: { stage: 'hung', government: null } })).toBeNull();
    expect(validateSave({ ...good, government: {} })).toBeNull();
    const { government: _g, ...noGov } = good;
    expect(validateSave(noGov)).toBeNull();
    const { election: _e, ...noElection } = good;
    expect(validateSave(noElection)).toBeNull(); // v3 saves must say whether an election happened
  });
});
