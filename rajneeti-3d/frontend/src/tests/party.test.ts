import { describe, expect, it } from 'vitest';
import { generateMembers } from '../simulation/candidates/members';
import { generateConstituencies } from '../simulation/candidates/constituencies';
import { assignTicket, autoAssign, removeTicket, replaceTicket, validateAssignments } from '../simulation/candidates/tickets';
import { suitability } from '../simulation/candidates/suitability';
import { grievance, reactToDenial } from '../simulation/candidates/rebellion';
import { Rng } from '../simulation/core/rng';
import { receiveFunds, spendFunds } from '../simulation/parties/finance';

const members = generateMembers(42);
const cs = generateConstituencies(42);

describe('member generation', () => {
  it('creates exactly 300 members with unique ids and names', () => {
    expect(members).toHaveLength(300);
    expect(new Set(members.map((m) => m.id)).size).toBe(300);
    expect(new Set(members.map((m) => m.name)).size).toBe(300);
  });
  it('is deterministic per seed and differs between seeds', () => {
    expect(generateMembers(42)).toEqual(members);
    expect(generateMembers(43)).not.toEqual(members);
  });
  it('produces varied attributes', () => {
    const pops = members.map((m) => m.popularity);
    expect(Math.max(...pops) - Math.min(...pops)).toBeGreaterThan(40);
    expect(members.every((m) => m.allies.length === 2 && !m.allies.includes(m.id))).toBe(true);
  });
});

describe('constituencies', () => {
  it('creates exactly 180 unique constituencies with 1,000,000 voters', () => {
    expect(cs).toHaveLength(180);
    expect(new Set(cs.map((c) => c.id)).size).toBe(180);
    expect(cs.reduce((s, c) => s + c.eligibleVoters, 0)).toBe(1_000_000);
  });
  it('differ by profile', () => {
    const ag = cs.filter((c) => c.profile === 'agricultural');
    const metro = cs.filter((c) => c.profile === 'metro');
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(metro.map((c) => c.infrastructure))).toBeGreaterThan(avg(ag.map((c) => c.infrastructure)));
  });
});

describe('ticket rules', () => {
  it('assigns, and rejects duplicates in both directions', () => {
    const r1 = assignTicket({}, members, cs, 'M001', 'C001');
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(assignTicket(r1.assignments, members, cs, 'M001', 'C002').ok).toBe(false); // same member twice
    expect(assignTicket(r1.assignments, members, cs, 'M002', 'C001').ok).toBe(false); // seat already filled
    expect(assignTicket(r1.assignments, members, cs, 'M002', 'C999').ok).toBe(false); // bad constituency
    expect(assignTicket(r1.assignments, members, cs, 'M999', 'C002').ok).toBe(false); // bad member
  });
  it('replaces and removes, reporting the displaced member', () => {
    const a = assignTicket({}, members, cs, 'M001', 'C001');
    if (!a.ok) throw new Error('setup');
    const rep = replaceTicket(a.assignments, members, cs, 'M002', 'C001');
    expect(rep.ok && rep.displaced).toBe('M001');
    if (!rep.ok) return;
    const rem = removeTicket(rep.assignments, 'C001');
    expect(rem.ok && rem.displaced).toBe('M002');
    expect(removeTicket({}, 'C001').ok).toBe(false);
  });
  it('auto-assign fills all 180 seats with 180 distinct candidates, deterministically', () => {
    const a = autoAssign({}, members, cs);
    expect(Object.keys(a)).toHaveLength(180);
    expect(new Set(Object.values(a)).size).toBe(180);
    expect(validateAssignments(a, members, cs)).toBe(true);
    expect(autoAssign({}, members, cs)).toEqual(a);
  });
  it('auto-assign keeps existing manual choices', () => {
    const a = autoAssign({ C005: 'M010' }, members, cs);
    expect(a.C005).toBe('M010');
    expect(Object.values(a).filter((m) => m === 'M010')).toHaveLength(1);
  });
  it('rejects assignments that break the rules', () => {
    expect(validateAssignments({ C001: 'M001', C002: 'M001' }, members, cs)).toBe(false);
    expect(validateAssignments({ C999: 'M001' }, members, cs)).toBe(false);
  });
  it('suitability stays in range and rewards strong, local candidates', () => {
    for (const m of members.slice(0, 50)) expect(suitability(m, cs[0])).toBeLessThanOrEqual(100);
    const m = members[0];
    const home = cs.find((c) => c.id === m.preferredConstituency)!;
    const other = cs.find((c) => c.id !== m.preferredConstituency && c.profile === home.profile && c.classification === home.classification)!;
    expect(suitability(m, home)).toBeGreaterThan(suitability(m, other) - 0.01);
  });
});

describe('rebellion', () => {
  it('most denied members do not rebel, but some do', () => {
    const kinds: Record<string, number> = {};
    members.forEach((m, i) => {
      const r = reactToDenial(m, new Rng(1000 + i), 'normal');
      kinds[r.reaction] = (kinds[r.reaction] ?? 0) + 1;
    });
    expect(kinds['accept']).toBeGreaterThan(60);
    const severe = (kinds['resign'] ?? 0) + (kinds['join-other-party'] ?? 0) + (kinds['independent'] ?? 0) + (kinds['internal-opposition'] ?? 0);
    expect(severe).toBeLessThan(150);
    expect(Object.keys(kinds).length).toBeGreaterThan(2);
  });
  it('is reproducible and respects difficulty', () => {
    const m = members[7];
    expect(reactToDenial(m, new Rng(5), 'normal').reaction).toBe(reactToDenial(m, new Rng(5), 'normal').reaction);
    expect(grievance(m, 'realistic')).toBeGreaterThanOrEqual(grievance(m, 'easy'));
  });
});

describe('party finance', () => {
  it('spending reduces funds and invalid amounts are rejected', () => {
    const r = spendFunds(50, 12.5);
    expect(r.ok && r.funds).toBe(37.5);
    expect(spendFunds(50, -1).ok).toBe(false);
    expect(spendFunds(50, NaN).ok).toBe(false);
    expect(spendFunds(10, 11).ok).toBe(false);
  });
  it('revenue increases funds', () => {
    const r = receiveFunds(10, 5);
    expect(r.ok && r.funds).toBe(15);
  });
});
