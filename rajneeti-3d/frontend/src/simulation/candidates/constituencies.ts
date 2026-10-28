import { Rng } from '../core/rng';
import { TOTAL_CONSTITUENCIES } from '../../data/constants';
import type { Constituency, Profile } from '../parties/types';
import { cid } from './members';

export const REGIONS = ['Northern Plains','Eastern Delta','Western Coast','Central Plateau','Southern Hills','Riverlands','Desert Belt','Island Territories','Metro Corridor'];
const PREFIX = ['Sundar','Nila','Ram','Kesar','Hari','Mahan','Tara','Veer','Chandan','Gokul','Surya','Amar','Lotus','Silver','Green','Stone','Bright','Golden','River','Maple'];
const SUFFIX = ['pur','nagar','garh','abad','vadi','kot','ganj','wal','pet','bazar'];

interface Template { base: [number, number, number, number, number]; urban: boolean; issues: string[] } // economy, education, employment, infra, health
const TEMPLATES: Record<Profile, Template> = {
  industrial: { base: [70, 55, 55, 65, 55], urban: true, issues: ['Jobs','Transport','Air quality'] },
  agricultural: { base: [45, 40, 50, 35, 40], urban: false, issues: ['Irrigation','Crop prices','Rural roads'] },
  university: { base: [60, 80, 50, 60, 60], urban: true, issues: ['Education','Graduate jobs','Housing'] },
  metro: { base: [80, 70, 65, 75, 70], urban: true, issues: ['Housing','Transport','Cost of living'] },
  coastal: { base: [55, 55, 55, 50, 50], urban: false, issues: ['Fisheries','Disaster relief','Ports'] },
  hill: { base: [40, 50, 40, 30, 35], urban: false, issues: ['Connectivity','Healthcare access','Tourism'] },
};
const PROFILES = Object.keys(TEMPLATES) as Profile[];
const TARGET_VOTERS = 1_000_000;

/** Exactly 180 constituencies; eligible voters sum to exactly 1,000,000. */
export function generateConstituencies(seed: number): Constituency[] {
  const rng = new Rng(seed ^ 0x51ed270b);
  const used = new Set<string>();
  const raw: { name: string; profile: Profile; weight: number }[] = [];
  for (let i = 0; i < TOTAL_CONSTITUENCIES; i++) {
    let name = '';
    do { name = `${rng.pick(PREFIX)}${rng.pick(SUFFIX)}`; } while (used.has(name));
    used.add(name);
    const profile = rng.weighted([
      { item: 'industrial' as Profile, weight: 3 }, { item: 'agricultural' as Profile, weight: 4 }, { item: 'university' as Profile, weight: 1 },
      { item: 'metro' as Profile, weight: 2 }, { item: 'coastal' as Profile, weight: 2 }, { item: 'hill' as Profile, weight: 2 },
    ]);
    raw.push({ name, profile, weight: rng.int(60, 150) });
  }
  const totalWeight = raw.reduce((s, r) => s + r.weight, 0);
  const voters = raw.map((r) => Math.floor((r.weight / totalWeight) * TARGET_VOTERS));
  voters[0] += TARGET_VOTERS - voters.reduce((s, v) => s + v, 0);

  return raw.map((r, i) => {
    const t = TEMPLATES[r.profile];
    const v = (n: number): number => Math.max(5, Math.min(98, n + rng.int(-12, 12)));
    return {
      id: cid(i + 1), name: r.name, region: REGIONS[i % REGIONS.length],
      population: Math.round(voters[i] * rng.int(14, 17) / 10),
      eligibleVoters: voters[i],
      classification: t.urban ? 'urban' : 'rural', profile: r.profile,
      economy: v(t.base[0]), education: v(t.base[1]), employment: v(t.base[2]), infrastructure: v(t.base[3]), healthcare: v(t.base[4]),
      historicalSupport: rng.bell(15, 45),
      issues: t.issues.slice(0, rng.int(2, 3)),
    };
  });
}
