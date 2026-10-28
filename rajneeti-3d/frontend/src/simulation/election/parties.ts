import { Rng } from '../core/rng';
import { REGIONS } from '../candidates/constituencies';
import type { Ideology, Member, Profile } from '../parties/types';
import type { Assignments } from '../candidates/tickets';
import type { RivalParty } from './types';

const DEFS: { id: string; name: string; abbreviation: string; color: string; ideology: Ideology; base: number }[] = [
  { id: 'NPA', name: 'National Progress Alliance', abbreviation: 'NPA', color: '#2a6fdb', ideology: 'economic-development', base: 51 },
  { id: 'JSM', name: 'Janata Samajik Morcha', abbreviation: 'JSM', color: '#d62839', ideology: 'social-welfare', base: 51 },
  { id: 'HKP', name: 'Hind Kisan Party', abbreviation: 'HKP', color: '#3a9d4a', ideology: 'regional-development', base: 45 },
  { id: 'RPD', name: 'Rashtriya Parampara Dal', abbreviation: 'RPD', color: '#8a4fbf', ideology: 'traditional-conservatism', base: 47 },
  { id: 'GFF', name: 'Green Future Front', abbreviation: 'GFF', color: '#12a38a', ideology: 'environmental-reform', base: 42 },
];

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));

/** Five rival parties. Deterministic for a given seed. */
export function generateRivals(seed: number, term = 1, incumbent?: { id: string; approval: number }): RivalParty[] {
  const rng = new Rng(seed ^ 0x7a31c5d3);
  const drift = new Rng((seed ^ Math.imul(term, 0x9e3779b1)) >>> 0);
  return DEFS.map((d) => {
    const regionAffinity: Record<string, number> = {};
    for (const r of REGIONS) regionAffinity[r] = rng.bell(25, 75);
    let strength = clamp(d.base + rng.int(-6, 6));
    if (term > 1) strength = clamp(strength + drift.int(-5, 5));
    // Governing parties are judged on their record: unpopular ones lose ground, popular ones gain a little.
    if (incumbent && incumbent.id === d.id) strength = clamp(strength + Math.max(-8, Math.min(3, (incumbent.approval - 50) * 0.25)));
    return {
      id: d.id, name: d.name, abbreviation: d.abbreviation, color: d.color, ideology: d.ideology,
      strength: Math.round(strength * 10) / 10, regionAffinity,
      personality: (['ambitious', 'loyal', 'aggressive', 'ideological', 'negotiator'] as const)[rng.int(0, 4)],
      negotiationSkill: rng.int(35, 90), ministryDemand: rng.int(1, 5),
    };
  });
}

const FIT: Record<Ideology, Partial<Record<Profile, number>>> = {
  'economic-development': { industrial: 6, metro: 4, agricultural: -2, hill: -3 },
  'social-welfare': { agricultural: 4, industrial: 3, metro: -1 },
  'environmental-reform': { hill: 5, coastal: 4, university: 3, industrial: -4 },
  'regional-development': { agricultural: 5, hill: 4, coastal: 3, metro: -3 },
  'liberal-reform': { university: 6, metro: 5, agricultural: -3 },
  'traditional-conservatism': { agricultural: 3, hill: 3, metro: -4, university: -4 },
  'centrist-governance': { industrial: 1, metro: 1, agricultural: 1, coastal: 1, hill: 1, university: 1 },
};

/** How well an ideology suits a kind of constituency, in score points. */
export function ideologyFit(ideology: Ideology, profile: Profile): number {
  return FIT[ideology][profile] ?? 0;
}

const IDEOLOGY_ORDER: Ideology[] = [
  'economic-development', 'social-welfare', 'environmental-reform', 'regional-development',
  'liberal-reform', 'traditional-conservatism', 'centrist-governance',
];

/** The player's party takes the ideology most common among its official candidates (centrist if it has none). */
export function partyIdeology(members: Member[], assignments: Assignments): Ideology {
  const byId = new Map(members.map((m) => [m.id, m]));
  const counts = new Map<Ideology, number>();
  for (const id of Object.values(assignments)) {
    const m = byId.get(id);
    if (m) counts.set(m.ideology, (counts.get(m.ideology) ?? 0) + 1);
  }
  let best: Ideology = 'centrist-governance';
  let bestN = 0;
  for (const i of IDEOLOGY_ORDER) {
    const n = counts.get(i) ?? 0;
    if (n > bestN) { best = i; bestN = n; }
  }
  return best;
}
