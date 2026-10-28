import { Rng } from '../core/rng';
import { TOTAL_CONSTITUENCIES, TOTAL_MEMBERS } from '../../data/constants';
import type { Ideology, Member } from '../parties/types';

export const FIRST = ['Aarav','Priya','Kabir','Ananya','Rohan','Meera','Vikram','Sana','Imran','Lakshmi','Harpreet','Deepa','Suresh','Nisha','Arjun','Fatima','Ganesh','Pooja','Tenzin','Rekha','Dev','Kavita','Manoj','Zoya','Rajesh','Shweta','Naveen','Asha','Karthik','Mehak','Sandeep','Bhavna','Yash','Tara','Omkar','Ishita','Faisal','Gauri','Mohan','Leela'];
export const LAST = ['Sharma','Reddy','Khan','Das','Nair','Gill','Patel','Menon','Bose','Joshi','Iyer','Singh','Mishra','Chopra','Rao','Banerjee','Kulkarni','Thakur','Dsouza','Pillai','Sethi','Verma','Naidu','Ansari','Mehta','Bhatt','Kapoor','Yadav','Lal','Ghosh','Hegde','Sinha','Tiwari','Roy','Shetty','Dutta','Bajwa','Mukherjee','Chauhan','Kaur'];
const EDU = ['High School','Bachelor of Arts','Bachelor of Commerce','Bachelor of Engineering','Law Degree','Master of Public Policy','Master of Economics','Medical Degree','PhD'];
const IDEOLOGIES: Ideology[] = ['economic-development','social-welfare','environmental-reform','regional-development','liberal-reform','traditional-conservatism','centrist-governance'];
const ROLES = [
  { item: 'Party Worker', weight: 40 }, { item: 'District Organiser', weight: 25 }, { item: 'Spokesperson', weight: 10 },
  { item: 'Youth Wing Leader', weight: 8 }, { item: 'Regional Leader', weight: 10 }, { item: 'Senior Committee Member', weight: 6 },
  { item: 'General Secretary', weight: 1 },
];

export const cid = (n: number): string => `C${String(n).padStart(3, '0')}`;

/** Exactly 300 members with unique IDs, deterministic for a given seed. */
export function generateMembers(seed: number): Member[] {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const names = new Set<string>();
  const members: Member[] = [];
  for (let i = 1; i <= TOTAL_MEMBERS; i++) {
    let name = '';
    do { name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`; } while (names.has(name) && names.size < FIRST.length * LAST.length);
    names.add(name);
    const age = rng.bell(28, 74);
    const experience = Math.min(age - 22, rng.bell(0, 40));
    const contested = rng.next() < Math.min(0.85, 0.2 + experience / 40);
    members.push({
      id: `M${String(i).padStart(3, '0')}`,
      name, age, experience,
      education: rng.pick(EDU),
      preferredConstituency: cid(rng.int(1, TOTAL_CONSTITUENCIES)),
      popularity: rng.bell(10, 90),
      loyalty: rng.bell(25, 100),
      reputation: rng.bell(20, 95),
      ambition: rng.bell(15, 100),
      leadership: rng.bell(10, 95),
      campaigning: rng.bell(10, 95),
      previousMargin: contested ? rng.bell(-25, 25) : null,
      relationshipWithPresident: rng.bell(-20, 50),
      allies: [], rivals: [],
      ideology: rng.pick(IDEOLOGIES),
      role: rng.weighted(ROLES),
      status: 'active',
      opposesLeadership: false,
    });
  }
  for (const m of members) {
    const pickOthers = (n: number): string[] => {
      const out: string[] = [];
      while (out.length < n) {
        const o = members[rng.int(0, members.length - 1)].id;
        if (o !== m.id && !out.includes(o)) out.push(o);
      }
      return out;
    };
    m.allies = pickOthers(2);
    m.rivals = pickOthers(2).filter((id) => !m.allies.includes(id));
  }
  return members;
}

/** Creates additional ordinary party members; these never create parliamentary seats by themselves. */
export function generateAdditionalMembers(seed: number, startNumber: number, count: number): Member[] {
  const source = generateMembers(seed ^ 0x51f15e);
  return source.slice(0, count).map((m, i) => ({
    ...m, id: `M${String(startNumber + i).padStart(4, '0')}`,
    allies: [], rivals: [], status: 'active' as const, previousMargin: null,
    role: i % 10 === 0 ? 'Youth Wing Leader' : 'Party Worker',
  }));
}
