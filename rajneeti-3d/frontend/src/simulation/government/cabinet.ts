import { MINISTRIES } from '../../data/constants';
import type { Member } from '../parties/types';
import { PLAYER_ID, type Government } from '../election/types';
import { MINISTRY_DEFS, type MinistryDef } from './types';

/** Who owns each of the 12 ministries. The leader's party takes the first posts, partners share the rest. */
export function ministryOwners(gov: Government): Record<string, string> {
  const owners: Record<string, string> = {};
  const order = [gov.leaderId, ...gov.partners];
  const queue: string[] = [];
  for (const id of order) for (let k = 0; k < (gov.ministries[id] ?? 0); k++) queue.push(id);
  MINISTRY_DEFS.slice(0, MINISTRIES).forEach((m, idx) => { owners[m.id] = queue[idx] ?? gov.leaderId; });
  return owners;
}

/** How well a member would run a ministry, 0..100. */
export function ministerScore(m: Member): number {
  const raw = m.leadership * 0.4 + m.reputation * 0.25 + Math.min(m.experience, 30) * 1.2 + m.loyalty * 0.1;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

export type CabinetResult = { ok: true; cabinet: Record<string, string> } | { ok: false; error: string };

/** Everyone in `members` the player could appoint. Only active party members can be ministers. */
export function eligibleMinisters(members: Member[], cabinet: Record<string, string>, ministryId?: string): Member[] {
  const taken = new Set(Object.entries(cabinet).filter(([k]) => k !== ministryId).map(([, v]) => v));
  return members.filter((m) => m.status === 'active' && !taken.has(m.id));
}

export function appointMinister(cabinet: Record<string, string>, members: Member[], owners: Record<string, string>, ministryId: string, memberId: string): CabinetResult {
  const def: MinistryDef | undefined = MINISTRY_DEFS.find((d) => d.id === ministryId);
  if (!def) return { ok: false, error: 'There is no such ministry.' };
  if (owners[ministryId] !== PLAYER_ID) return { ok: false, error: `${def.name} belongs to a coalition partner.` };
  const m = members.find((x) => x.id === memberId);
  if (!m) return { ok: false, error: 'There is no such member.' };
  if (m.status !== 'active') return { ok: false, error: `${m.name} is no longer in your party.` };
  const already = Object.entries(cabinet).find(([k, v]) => v === memberId && k !== ministryId);
  if (already) return { ok: false, error: `${m.name} already holds another ministry.` };
  return { ok: true, cabinet: { ...cabinet, [ministryId]: memberId } };
}

export function dismissMinister(cabinet: Record<string, string>, ministryId: string): CabinetResult {
  if (!cabinet[ministryId]) return { ok: false, error: 'That ministry is already vacant.' };
  const next = { ...cabinet };
  delete next[ministryId];
  return { ok: true, cabinet: next };
}

/** Average competence of the posts the player controls. Vacant or departed ministers count as 25. */
export function cabinetQuality(cabinet: Record<string, string>, owners: Record<string, string>, members: Member[]): number {
  const mine = Object.keys(owners).filter((k) => owners[k] === PLAYER_ID);
  if (mine.length === 0) return 50;
  const sum = mine.reduce((s, k) => {
    const m = members.find((x) => x.id === cabinet[k]);
    return s + (m && m.status === 'active' ? ministerScore(m) : 25);
  }, 0);
  return Math.round(sum / mine.length);
}

/** Members who left the party lose their post. Returns the cleaned cabinet and who was removed. */
export function pruneCabinet(cabinet: Record<string, string>, members: Member[]): { cabinet: Record<string, string>; removed: string[] } {
  const next: Record<string, string> = {};
  const removed: string[] = [];
  for (const [k, id] of Object.entries(cabinet)) {
    const m = members.find((x) => x.id === id);
    if (m && m.status === 'active') next[k] = id; else removed.push(k);
  }
  return { cabinet: next, removed };
}

/** Fills every ministry the player owns with the best available members. Explicit, never automatic. */
export function autoCabinet(members: Member[], owners: Record<string, string>, existing: Record<string, string>): Record<string, string> {
  const cabinet = { ...existing };
  const free = eligibleMinisters(members, cabinet).sort((a, b) => ministerScore(b) - ministerScore(a) || a.id.localeCompare(b.id));
  for (const def of MINISTRY_DEFS) {
    if (owners[def.id] !== PLAYER_ID || cabinet[def.id]) continue;
    const pick = free.shift();
    if (pick) cabinet[def.id] = pick.id;
  }
  return cabinet;
}
