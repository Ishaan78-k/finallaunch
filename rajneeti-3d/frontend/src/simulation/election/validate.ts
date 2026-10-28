import type { Constituency } from '../parties/types';
import type { BallotEntry, CampaignState, ConstituencyResult, ElectionOutcome, ElectionResult, Government, LocalCampaign } from './types';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function numberRecord(v: unknown): Record<string, number> | null {
  if (!isObj(v)) return null;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) {
    if (!isNum(n)) return null;
    out[k] = n;
  }
  return out;
}

export function validateCampaign(raw: unknown, cs: Constituency[]): CampaignState | null {
  if (!isObj(raw) || !isNum(raw.nationalSpend) || raw.nationalSpend < 0 || !isNum(raw.totalSpent) || raw.totalSpent < 0 || !isObj(raw.local)) return null;
  const ids = new Set(cs.map((c) => c.id));
  const local: Record<string, LocalCampaign> = {};
  for (const [id, l] of Object.entries(raw.local)) {
    if (!ids.has(id) || !isObj(l) || !isInt(l.rallies) || l.rallies < 0 || !isNum(l.adSpend) || l.adSpend < 0) return null;
    local[id] = { rallies: l.rallies, adSpend: l.adSpend };
  }
  return { nationalSpend: raw.nationalSpend, totalSpent: raw.totalSpent, local };
}

function validateEntry(e: unknown): BallotEntry | null {
  if (!isObj(e) || !isStr(e.key) || !isStr(e.partyId) || !isStr(e.candidateName) || !isInt(e.votes) || e.votes < 0 || !isNum(e.share)) return null;
  return { key: e.key, partyId: e.partyId, candidateName: e.candidateName, votes: e.votes, share: e.share };
}

function validateResult(raw: unknown, cs: Constituency[]): ElectionResult | null {
  if (!isObj(raw) || !isNum(raw.seed) || !isNum(raw.day) || !Array.isArray(raw.constituencies) || raw.constituencies.length !== cs.length) return null;
  const rows: ConstituencyResult[] = [];
  const seatCheck: Record<string, number> = {};
  let totalCast = 0;
  for (let i = 0; i < cs.length; i++) {
    const r: unknown = raw.constituencies[i];
    if (!isObj(r) || r.constituencyId !== cs[i].id || r.eligible !== cs[i].eligibleVoters) return null;
    if (!isInt(r.cast) || r.cast < 0 || r.cast > cs[i].eligibleVoters || !Array.isArray(r.entries) || r.entries.length === 0) return null;
    const entries: BallotEntry[] = [];
    for (const e of r.entries) {
      const v = validateEntry(e);
      if (!v) return null;
      entries.push(v);
    }
    if (entries.reduce((s, e) => s + e.votes, 0) !== r.cast) return null;
    if (r.winnerParty !== entries[0].partyId || !isNum(r.margin) || typeof r.playerContested !== 'boolean') return null;
    seatCheck[entries[0].partyId] = (seatCheck[entries[0].partyId] ?? 0) + 1;
    totalCast += r.cast;
    rows.push({ constituencyId: cs[i].id, eligible: cs[i].eligibleVoters, cast: r.cast, entries, winnerParty: entries[0].partyId, margin: r.margin, playerContested: r.playerContested });
  }
  const seats = numberRecord(raw.seats);
  const votes = numberRecord(raw.votes);
  const voteShare = numberRecord(raw.voteShare);
  if (!seats || !votes || !voteShare || !isNum(raw.turnout) || raw.totalCast !== totalCast) return null;
  const listed = Object.entries(seats).reduce((s, [, n]) => s + n, 0);
  if (listed !== cs.length) return null;
  for (const [id, n] of Object.entries(seats)) if ((seatCheck[id] ?? 0) !== n) return null;
  for (const id of Object.keys(seatCheck)) if (!(id in seats)) return null;
  return { seed: raw.seed, day: raw.day, constituencies: rows, seats, votes, voteShare, totalCast, turnout: raw.turnout };
}

function validateGovernment(raw: unknown): Government | null {
  if (!isObj(raw)) return null;
  if (raw.type !== 'majority' && raw.type !== 'coalition' && raw.type !== 'minority') return null;
  if (raw.playerRole !== 'leader' && raw.playerRole !== 'partner' && raw.playerRole !== 'opposition') return null;
  if (!isStr(raw.leaderId) || !Array.isArray(raw.partners) || !raw.partners.every(isStr) || !isNum(raw.seats)) return null;
  const ministries = numberRecord(raw.ministries);
  if (!ministries) return null;
  return { type: raw.type, leaderId: raw.leaderId, partners: raw.partners as string[], seats: raw.seats, ministries, playerRole: raw.playerRole };
}

/** Returns a clean ElectionOutcome, or null if the data is corrupt or inconsistent with the constituencies. */
export function validateElectionOutcome(raw: unknown, cs: Constituency[]): ElectionOutcome | null {
  if (!isObj(raw) || (raw.stage !== 'hung' && raw.stage !== 'formed')) return null;
  const result = validateResult(raw.result, cs);
  if (!result) return null;
  if (raw.stage === 'hung') return raw.government === null ? { result, stage: 'hung', government: null } : null;
  const government = validateGovernment(raw.government);
  return government ? { result, stage: 'formed', government } : null;
}
