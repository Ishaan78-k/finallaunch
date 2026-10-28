import { OPPOSITION_BY_ID, type OppositionActionId, type OppositionState } from './opposition';
import type { PastElection, TermState } from './term';
import { CAUSE_BY_ID, POLICE_BY_ID, PROMISE_KINDS, type PoliceLevel, type PromiseRecord, type Protest, type ProtestRecord, type ProtestState, type CauseId, type PromiseKind } from './protests';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateTerm(raw: unknown): TermState | null {
  if (!isObj(raw)) return null;
  if (!Number.isInteger(raw.number) || (raw.number as number) < 1) return null;
  if (!isNum(raw.campaignStartDay) || !isNum(raw.electionDay) || raw.campaignStartDay >= raw.electionDay) return null;
  if (typeof raw.held !== 'boolean') return null;
  if (raw.nextElectionDay !== null && !isNum(raw.nextElectionDay)) return null;
  if (raw.held && raw.nextElectionDay === null) return null;
  if (!raw.held && raw.nextElectionDay !== null) return null;
  if (isNum(raw.nextElectionDay) && raw.nextElectionDay <= raw.electionDay) return null;
  return { number: raw.number as number, campaignStartDay: raw.campaignStartDay, electionDay: raw.electionDay, held: raw.held, nextElectionDay: raw.nextElectionDay as number | null };
}

function numMap(v: unknown): Record<string, number> | null {
  if (!isObj(v)) return null;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) { if (!isNum(n) || n < 0) return null; out[k] = n; }
  return out;
}

export function validatePast(raw: unknown): PastElection[] | null {
  if (!Array.isArray(raw)) return null;
  const out: PastElection[] = [];
  for (const r of raw as unknown[]) {
    if (!isObj(r) || !Number.isInteger(r.term) || !isNum(r.day) || typeof r.early !== 'boolean') return null;
    const seats = numMap(r.seats); const voteShare = numMap(r.voteShare);
    if (!seats || !voteShare) return null;
    if (r.leaderId !== null && !isStr(r.leaderId)) return null;
    if (r.playerRole !== null && r.playerRole !== 'leader' && r.playerRole !== 'partner' && r.playerRole !== 'opposition') return null;
    out.push({ term: r.term as number, day: r.day, seats, voteShare, leaderId: r.leaderId as string | null, playerRole: r.playerRole as PastElection['playerRole'], early: r.early });
  }
  return out;
}

export function validateOpposition(raw: unknown): OppositionState | null {
  if (!isObj(raw)) return null;
  if (!isNum(raw.startDay) || !isNum(raw.lastMonthDay) || raw.lastMonthDay < raw.startDay) return null;
  if (!isNum(raw.rulingApproval) || raw.rulingApproval < 0 || raw.rulingApproval > 100) return null;
  if (!isNum(raw.standing) || raw.standing < 0 || raw.standing > 100) return null;
  if (raw.motionDay !== null && !isNum(raw.motionDay)) return null;
  if (typeof raw.rulingFallen !== 'boolean') return null;
  if (!isObj(raw.lastUsed)) return null;
  const lastUsed: Partial<Record<OppositionActionId, number>> = {};
  for (const [k, v] of Object.entries(raw.lastUsed)) {
    if (!(k in OPPOSITION_BY_ID) || !isNum(v)) return null;
    lastUsed[k as OppositionActionId] = v;
  }
  if (!Array.isArray(raw.history) || !raw.history.every(isStr)) return null;
  return { startDay: raw.startDay, lastMonthDay: raw.lastMonthDay, rulingApproval: raw.rulingApproval, standing: raw.standing, lastUsed, motionDay: raw.motionDay as number | null, rulingFallen: raw.rulingFallen, history: raw.history as string[] };
}

const OUTCOMES = ['peaceful', 'clash', 'damage'];

export function validateProtests(raw: unknown): ProtestState | null {
  if (!isObj(raw)) return null;
  if (!isNum(raw.lastProtestDay) || !isNum(raw.unrest) || raw.unrest < 0 || raw.unrest > 100) return null;
  if (!isNum(raw.policeTrust) || raw.policeTrust < 0 || raw.policeTrust > 100) return null;
  let active: Protest | null = null;
  if (raw.active !== null) {
    const a = raw.active;
    if (!isObj(a) || !isStr(a.cause) || !(a.cause in CAUSE_BY_ID)) return null;
    if (!isNum(a.startDay) || !isNum(a.deadline) || a.deadline < a.startDay) return null;
    if (!isNum(a.size) || a.size < 1 || a.size > 1000000 || !isNum(a.intensity) || a.intensity < 0 || a.intensity > 100) return null;
    if (a.status !== 'open' && a.status !== 'dispersing') return null;
    if (a.police !== null && !(isStr(a.police) && a.police in POLICE_BY_ID)) return null;
    if (a.outcome !== null && !(isStr(a.outcome) && OUTCOMES.includes(a.outcome))) return null;
    if (a.response !== null && (!Number.isInteger(a.response) || (a.response as number) < 0 || (a.response as number) > 2)) return null;
    if (a.endDay !== null && !isNum(a.endDay)) return null;
    // An open protest has not been answered; a dispersing one has.
    if (a.status === 'open' && (a.police !== null || a.outcome !== null || a.endDay !== null)) return null;
    if (a.status === 'dispersing' && (a.police === null || a.outcome === null || a.endDay === null)) return null;
    active = {
      cause: a.cause as CauseId, startDay: a.startDay, deadline: a.deadline, size: a.size, intensity: a.intensity, status: a.status,
      response: a.response as number | null, police: a.police as PoliceLevel | null, outcome: a.outcome as Protest['outcome'], endDay: a.endDay as number | null,
    };
  }
  if (!Array.isArray(raw.promises) || !Array.isArray(raw.log)) return null;
  const promises: PromiseRecord[] = [];
  const ids = new Set<string>();
  for (const p of raw.promises as unknown[]) {
    if (!isObj(p) || !isStr(p.id) || ids.has(p.id) || !isStr(p.cause) || !(p.cause in CAUSE_BY_ID)) return null;
    if (!isStr(p.kind) || !PROMISE_KINDS.includes(p.kind as PromiseKind) || (p.key !== null && !isStr(p.key))) return null;
    if (!isNum(p.target) || !isStr(p.text) || !isNum(p.madeDay) || !isNum(p.deadline) || p.deadline < p.madeDay) return null;
    if (p.status !== 'pending' && p.status !== 'kept' && p.status !== 'broken') return null;
    ids.add(p.id);
    promises.push({ id: p.id, cause: p.cause as CauseId, kind: p.kind as PromiseKind, key: p.key as string | null, target: p.target, text: p.text, madeDay: p.madeDay, deadline: p.deadline, status: p.status });
  }
  const log: ProtestRecord[] = [];
  for (const r of raw.log as unknown[]) {
    if (!isObj(r) || !isStr(r.cause) || !(r.cause in CAUSE_BY_ID) || !isNum(r.day) || !isNum(r.size) || !isNum(r.injuries) || !isNum(r.arrests) || !isNum(r.approvalChange)) return null;
    if (r.choice !== null && (!Number.isInteger(r.choice) || (r.choice as number) < 0 || (r.choice as number) > 2)) return null;
    if (!isStr(r.police) || !(r.police in POLICE_BY_ID) || !isStr(r.outcome) || !OUTCOMES.includes(r.outcome)) return null;
    if (r.injuries < 0 || r.arrests < 0) return null;
    log.push({ cause: r.cause as CauseId, day: r.day, size: r.size, choice: r.choice as number | null, police: r.police as PoliceLevel, outcome: r.outcome as ProtestRecord['outcome'], injuries: r.injuries, arrests: r.arrests, approvalChange: r.approvalChange });
  }
  return { active, lastProtestDay: raw.lastProtestDay, unrest: raw.unrest, policeTrust: raw.policeTrust, promises, log };
}
