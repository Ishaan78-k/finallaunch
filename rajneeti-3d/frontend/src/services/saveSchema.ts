import { SAVE_VERSION, TOTAL_MEMBERS } from '../data/constants';
import type { Member } from '../simulation/parties/types';
import { generateConstituencies } from '../simulation/candidates/constituencies';
import { validateCampaign, validateElectionOutcome } from '../simulation/election/validate';
import type { CampaignState, ElectionOutcome } from '../simulation/election/types';
import { validateGovState } from '../simulation/government/validate';
import type { GovState } from '../simulation/government/types';
import { validateOpposition, validatePast, validateTerm } from '../simulation/world/validate';
import type { OppositionState } from '../simulation/world/opposition';
import type { PastElection, TermState } from '../simulation/world/term';

export interface SaveData {
  version: number;
  savedAt: number;
  player: { name: string; pronouns: string };
  party: { name: string; abbreviation: string; color: string };
  clock: { day: number; minutes: number };
  funds: number;
  popularity: number;
  position: { x: number; z: number; rotY: number };
  objectives: Record<string, boolean>;
  seed: number;
  members: Member[];
  /** constituencyId -> memberId */
  assignments: Record<string, string>;
  log: string[];
  campaign: CampaignState;
  /** null until election day has happened. */
  election: ElectionOutcome | null;
  /** null until you lead a government. */
  government: GovState | null;
  /** Which election is next, and whether this term's election has been held. */
  term: TermState;
  /** Every national election held so far. */
  pastElections: PastElection[];
  /** Present while the player leads the opposition. */
  opposition: OppositionState | null;
  /** Day party donations were last paid in. */
  incomeDay: number;
  seatSharing?: Record<string, string>;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const STATUSES = ['active', 'resigned', 'joined-other-party', 'independent'];
const NUM_FIELDS = ['age', 'experience', 'popularity', 'loyalty', 'reputation', 'ambition', 'leadership', 'campaigning', 'relationshipWithPresident'] as const;

function validMember(m: unknown): m is Member {
  if (!isObj(m)) return false;
  if (!isStr(m.id) || !isStr(m.name) || !isStr(m.education) || !isStr(m.preferredConstituency) || !isStr(m.ideology) || !isStr(m.role)) return false;
  if (!isStr(m.status) || !STATUSES.includes(m.status) || typeof m.opposesLeadership !== 'boolean') return false;
  if (m.previousMargin !== null && !isNum(m.previousMargin)) return false;
  if (!Array.isArray(m.allies) || !Array.isArray(m.rivals)) return false;
  return NUM_FIELDS.every((k) => isNum(m[k]));
}

/** Returns a validated SaveData, or null if the input is corrupt or from an unknown version. */
export function validateSave(raw: unknown): SaveData | null {
  if (!isObj(raw) || raw.version !== SAVE_VERSION || !isNum(raw.savedAt)) return null;
  const { player, party, clock, position, objectives } = raw;
  if (!isObj(player) || !isStr(player.name) || !isStr(player.pronouns)) return null;
  if (!isObj(party) || !isStr(party.name) || !isStr(party.abbreviation) || !isStr(party.color)) return null;
  if (!isObj(clock) || !isNum(clock.day) || !isNum(clock.minutes)) return null;
  if (clock.day < 1 || clock.minutes < 0 || clock.minutes >= 1440) return null;
  if (!isNum(raw.funds) || raw.funds < 0) return null;
  if (!isNum(raw.popularity) || raw.popularity < 0 || raw.popularity > 100) return null;
  if (!isObj(position) || !isNum(position.x) || !isNum(position.z) || !isNum(position.rotY)) return null;
  if (!isObj(objectives)) return null;
  if (!isNum(raw.seed) || !Array.isArray(raw.members) || raw.members.length < TOTAL_MEMBERS || !raw.members.every(validMember)) return null;
  const ids = new Set(raw.members.map((m: Member) => m.id));
  if (ids.size !== raw.members.length) return null;
  if (!isObj(raw.assignments)) return null;
  const assignments: Record<string, string> = {};
  const used = new Set<string>();
  for (const [c, m] of Object.entries(raw.assignments)) {
    if (!isStr(m) || !ids.has(m) || used.has(m) || !/^C\d{3}$/.test(c) || Number(c.slice(1)) < 1 || Number(c.slice(1)) > 180) return null;
    used.add(m);
    assignments[c] = m;
  }
  if (!Array.isArray(raw.log) || !raw.log.every(isStr)) return null;
  const cs = generateConstituencies(raw.seed);
  const campaign = validateCampaign(raw.campaign, cs);
  if (!campaign) return null;
  let election: ElectionOutcome | null = null;
  if (raw.election !== null) {
    election = validateElectionOutcome(raw.election, cs);
    if (!election) return null;
  }
  let government: GovState | null = null;
  if (raw.government !== null) {
    // Only a player-led government can be run, and only after an election has formed one.
    if (!election || election.stage !== 'formed' || election.government?.playerRole !== 'leader') return null;
    government = validateGovState(raw.government, ids);
    if (!government) return null;
  }
  const term = validateTerm(raw.term);
  if (!term) return null;
  const pastElections = validatePast(raw.pastElections);
  if (!pastElections) return null;
  // The term, the election record and the list of past elections must agree.
  const expectedPast = term.held ? term.number : term.number - 1;
  if (pastElections.length !== expectedPast) return null;
  if ((election !== null) !== (expectedPast >= 1)) return null;
  if (!isNum(raw.incomeDay) || raw.incomeDay < 1) return null;
  let opposition: OppositionState | null = null;
  if (raw.opposition !== null) {
    if (!election || election.stage !== 'formed' || election.government?.playerRole !== 'opposition') return null;
    opposition = validateOpposition(raw.opposition);
    if (!opposition) return null;
  }
  const obj: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(objectives)) {
    if (typeof v !== 'boolean') return null;
    obj[k] = v;
  }
  return {
    version: SAVE_VERSION,
    savedAt: raw.savedAt,
    player: { name: player.name, pronouns: player.pronouns },
    party: { name: party.name, abbreviation: party.abbreviation, color: party.color },
    clock: { day: clock.day, minutes: clock.minutes },
    funds: raw.funds,
    popularity: raw.popularity,
    position: { x: position.x, z: position.z, rotY: position.rotY },
    objectives: obj,
    seed: raw.seed,
    members: raw.members as Member[],
    assignments,
    log: raw.log as string[],
    campaign,
    election,
    government,
    term,
    pastElections,
    opposition,
    incomeDay: raw.incomeDay,
  };
}
