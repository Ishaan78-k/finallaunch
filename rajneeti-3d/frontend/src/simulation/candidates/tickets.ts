import { TOTAL_CONSTITUENCIES } from '../../data/constants';
import type { Constituency, Member } from '../parties/types';
import { suitability } from './suitability';

/** constituencyId -> memberId. One official candidate per constituency, one ticket per member. */
export type Assignments = Record<string, string>;
export type TicketResult =
  | { ok: true; assignments: Assignments; displaced: string | null }
  | { ok: false; error: string };

const assignedMembers = (a: Assignments): Set<string> => new Set(Object.values(a));

function checkMember(members: Member[], a: Assignments, memberId: string): string | null {
  const m = members.find((x) => x.id === memberId);
  if (!m) return `Unknown member ${memberId}.`;
  if (m.status !== 'active') return `${m.name} is no longer with the party.`;
  if (assignedMembers(a).has(memberId)) return `${m.name} already holds a ticket.`;
  return null;
}

const hasConstituency = (cs: Constituency[], id: string): boolean => cs.some((c) => c.id === id);

export function assignTicket(a: Assignments, members: Member[], cs: Constituency[], memberId: string, constituencyId: string): TicketResult {
  if (!hasConstituency(cs, constituencyId)) return { ok: false, error: `Invalid constituency ${constituencyId}.` };
  if (a[constituencyId]) return { ok: false, error: 'That constituency already has an official candidate. Use Replace.' };
  if (Object.keys(a).length >= TOTAL_CONSTITUENCIES) return { ok: false, error: 'All 180 tickets are already issued.' };
  const err = checkMember(members, a, memberId);
  if (err) return { ok: false, error: err };
  return { ok: true, assignments: { ...a, [constituencyId]: memberId }, displaced: null };
}

export function replaceTicket(a: Assignments, members: Member[], cs: Constituency[], memberId: string, constituencyId: string): TicketResult {
  if (!hasConstituency(cs, constituencyId)) return { ok: false, error: `Invalid constituency ${constituencyId}.` };
  const old = a[constituencyId];
  if (!old) return { ok: false, error: 'No candidate to replace there.' };
  const err = checkMember(members, a, memberId);
  if (err) return { ok: false, error: err };
  return { ok: true, assignments: { ...a, [constituencyId]: memberId }, displaced: old };
}

export function removeTicket(a: Assignments, constituencyId: string): TicketResult {
  const old = a[constituencyId];
  if (!old) return { ok: false, error: 'No candidate assigned there.' };
  const next = { ...a };
  delete next[constituencyId];
  return { ok: true, assignments: next, displaced: old };
}

/** Explicit player-chosen auto selection: fills only empty constituencies, best fit first. Deterministic. */
export function autoAssign(a: Assignments, members: Member[], cs: Constituency[]): Assignments {
  const next = { ...a };
  const taken = assignedMembers(next);
  const pool = members.filter((m) => m.status === 'active' && !taken.has(m.id));
  const open = cs.filter((c) => !next[c.id]);
  const pairs: { m: Member; c: Constituency; s: number }[] = [];
  for (const c of open) for (const m of pool) pairs.push({ m, c, s: suitability(m, c) });
  pairs.sort((x, y) => y.s - x.s || x.m.id.localeCompare(y.m.id) || x.c.id.localeCompare(y.c.id));
  for (const p of pairs) {
    if (next[p.c.id] || taken.has(p.m.id)) continue;
    next[p.c.id] = p.m.id;
    taken.add(p.m.id);
  }
  return next;
}

export function validateAssignments(a: unknown, members: Member[], cs: Constituency[]): a is Assignments {
  if (typeof a !== 'object' || a === null) return false;
  const seen = new Set<string>();
  for (const [cId, mId] of Object.entries(a)) {
    if (typeof mId !== 'string' || !hasConstituency(cs, cId) || seen.has(mId)) return false;
    if (!members.some((m) => m.id === mId)) return false;
    seen.add(mId);
  }
  return seen.size <= TOTAL_CONSTITUENCIES;
}
