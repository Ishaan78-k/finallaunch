import { create } from 'zustand';
import { DIALOGUES, type DialogueChoice } from '../data/dialogues';
import { START_PARTY_FUNDS_CRORE, START_POPULARITY, SAVE_VERSION } from '../data/constants';
import { advanceClock, createClock, skipToNextMorning, type GameClock } from '../simulation/calendar/clock';
import type { SaveData } from '../services/saveSchema';
import { Rng, hashString } from '../simulation/core/rng';
import { generateMembers, generateAdditionalMembers } from '../simulation/candidates/members';
import { generateConstituencies } from '../simulation/candidates/constituencies';
import { assignTicket, autoAssign, removeTicket, replaceTicket, type Assignments } from '../simulation/candidates/tickets';
import { LEAVES_PARTY, reactToDenial } from '../simulation/candidates/rebellion';
import { TOTAL_CONSTITUENCIES } from '../data/constants';
import type { Constituency, Member, Ideology } from '../simulation/parties/types';
import { generateRivals, partyIdeology } from '../simulation/election/parties';
import { applyResultsToMembers, runElection } from '../simulation/election/model';
import { buyLocalAds, buyNationalAds, emptyCampaign, holdRally } from '../simulation/election/campaign';
import { autoGovernment, formCoalition, resolveElection } from '../simulation/election/coalition';
import { advanceGovernment, canRun, proposeBill, respondToCrisis, setSpending, setTaxes, startGovernment, type GovContext } from '../simulation/government/state';
import { appointMinister, autoCabinet, dismissMinister, ministryOwners } from '../simulation/government/cabinet';
import { applyIncomingSwitch, applyOutgoingSwitch, breakAlliance, resignMinister, seedSwitchingRequests, resolveMeeting, seedMeetings, manageMinistry } from '../simulation/government/phase7';
import type { BillId, GovState, Sector, Taxes } from '../simulation/government/types';
import {
  CAMPAIGN_LEAD_DAYS, advanceTerm, carryPopularity, cycleDue, earlyTerm, firstTerm, incomeMonths, markHeld, monthlyDonations, rolloverMembers, windowOf,
  type PastElection, type TermState,
} from '../simulation/world/term';
import { advanceOpposition, moveNoConfidence, popularityTarget, startOpposition, takeOppositionAction, type OppositionActionId, type OppositionState } from '../simulation/world/opposition';
import { decisionReaction, electionEffect, respondToProtest, type Decision, type PoliceLevel, type Reaction } from '../simulation/world/protests';
import { IND_ID, PLAYER_ID, type CampaignState, type ElectionContext, type ElectionOutcome } from '../simulation/election/types';
import { compatibility } from '../simulation/election/coalition';
import type { VoteResult } from '../simulation/government/parliament';

export type Screen = 'menu' | 'create' | 'playing';
export type Panel = null | 'dashboard' | 'candidates' | 'election' | 'government' | 'opposition' | 'phone' | 'map' | 'parliament' | 'war-room' | 'pause' | 'dialogue';
export type Quality = 'low' | 'medium' | 'high';

export interface PlayerInfo { name: string; pronouns: string }
export interface PartyInfo { name: string; abbreviation: string; color: string }
export interface Objective { id: string; label: string; available: boolean }
export type RecruitmentMethod = 'membership-campaign' | 'youth-program' | 'local-office' | 'door-to-door' | 'social-media' | 'recruit-politician';

export const OBJECTIVES: Objective[] = [
  { id: 'enter-hq', label: 'Enter party headquarters', available: true },
  { id: 'meet-secretary', label: 'Meet the political secretary', available: true },
  { id: 'open-candidates', label: 'Open the candidate management system', available: true },
  { id: 'review-candidates', label: 'Review available candidates', available: true },
  { id: 'assign-tickets', label: 'Assign all 180 election tickets', available: true },
  { id: 'run-campaign', label: 'Run a campaign (rally or ads) from Day 91', available: true },
  { id: 'win-election', label: 'Hold the national election on Day 181', available: true },
  { id: 'form-government', label: 'Form a government or lead the opposition', available: true },
  { id: 'appoint-cabinet', label: 'Appoint ministers to your cabinet', available: true },
  { id: 'pass-bill', label: 'Pass a bill through parliament', available: true },
  { id: 'handle-crisis', label: 'Handle a national crisis as Prime Minister', available: true },
  { id: 'handle-protest', label: 'Answer a public protest outside your office', available: true },
  { id: 'move-motion', label: 'Move a no-confidence motion from the opposition benches', available: true },
  { id: 'second-election', label: 'Win or lose a second national election', available: true },
  { id: 'manifesto', label: 'Prepare the party manifesto (later phase)', available: false },
];

const SPAWN = { x: 0, z: 8, rotY: Math.PI };
const isCoarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

interface GameState {
  screen: Screen;
  player: PlayerInfo;
  party: PartyInfo;
  clock: GameClock;
  speed: number;
  funds: number; // party funds, in crore (never the government treasury)
  popularity: number;
  objectives: Record<string, boolean>;
  position: { x: number; z: number; rotY: number };
  panel: Panel;
  dialogue: { id: string; nodeId: string } | null;
  toast: string | null;
  quality: Quality;
  sessionId: number;
  seed: number;
  members: Member[];
  constituencies: Constituency[];
  assignments: Assignments;
  log: string[];
  campaign: CampaignState;
  /** null until the election has been held. */
  election: ElectionOutcome | null;
  /** null until you lead a government. */
  government: GovState | null;
  term: TermState;
  pastElections: PastElection[];
  opposition: OppositionState | null;
  incomeDay: number;
  /** Latest crowd reaction for the 3D scene. Not saved. */
  crowdReaction: { seq: number; kind: Reaction } | null;
  preElectionAlliances: string[];
  lastVote: VoteResult | null;
  seatSharing: Record<string, string>;

  respondProtest: (optionIdx: number, police: PoliceLevel) => void;
  respond: (optionIdx: number) => void;
  oppose: (id: OppositionActionId) => void;
  noConfidence: () => void;
  callEarlyElection: () => void;
  setTax: (key: keyof Taxes, value: number) => void;
  setSector: (sector: Sector, amount: number) => void;
  appoint: (ministryId: string, memberId: string) => void;
  dismiss: (ministryId: string) => void;
  autoCabinetAll: () => void;
  propose: (billId: BillId) => void;
  skipDays: (n: number) => void;
  rallyAt: (constituencyId: string) => void;
  adsAt: (constituencyId: string, amount: number) => void;
  nationalAds: (amount: number) => void;
  jumpToDay: (day: number) => void;
  holdElection: () => void;
  proposeAlliance: (partyId: string) => void;
  setSeatShare: (constituencyId: string, partyId: string) => void;
  openWarRoom: () => void;
  negotiateCoalition: (partnerIds: string[]) => void;
  breakAlliance: (partnerId: string) => void;
  resolveSwitch: (requestId: string, decision: 'accept' | 'reject' | 'negotiate') => void;
  resolveMeeting: (meetingId: string, decision: 'accept' | 'reject' | 'counter' | 'postpone') => void;
  requestMeeting: () => void;
  manageMinistry: (ministryId: string, action: import('../simulation/government/types').MinistryAction) => void;
  recruitMembers: (method: RecruitmentMethod) => void;
  resign: (memberId: string) => void;
  joinOpposition: () => void;
  assignCandidate: (memberId: string, constituencyId: string) => void;
  removeCandidate: (constituencyId: string) => void;
  autoAssignAll: () => void;
  viewMember: (memberId: string) => void;
  goTo: (screen: Screen) => void;
  startNewGame: (player: PlayerInfo, party: PartyInfo) => void;
  applySave: (data: SaveData) => void;
  toSaveData: () => SaveData;
  setPanel: (panel: Panel) => void;
  togglePanel: (panel: Exclude<Panel, null>) => void;
  tick: (realSeconds: number) => void;
  setSpeed: (speed: number) => void;
  skipDay: () => void;
  completeObjective: (id: string) => void;
  openDialogue: (id: string) => void;
  chooseDialogue: (choice: DialogueChoice) => void;
  setPosition: (p: { x: number; z: number; rotY: number }) => void;
  showToast: (msg: string) => void;
  setQuality: (q: Quality) => void;
}

/** Applies denial reactions to the given members (deterministic per seed) and updates ticket state. */
function applyReactions(assignments: Assignments, memberIds: string[], constituencyId: string): void {
  const st = useGameStore.getState();
  const messages: string[] = [];
  let popDelta = 0;
  const members = st.members.map((m) => {
    if (!memberIds.includes(m.id)) return m;
    const rng = new Rng(st.seed ^ hashString(`${m.id}:${constituencyId}:${st.log.length}`));
    const r = reactToDenial(m, rng, 'normal');
    popDelta += r.partyPopularityDelta;
    messages.push(r.message(m.name));
    return {
      ...m,
      loyalty: Math.max(0, Math.min(100, m.loyalty + r.loyaltyDelta)),
      opposesLeadership: m.opposesLeadership || r.reaction === 'internal-opposition',
      status: LEAVES_PARTY.has(r.reaction)
        ? (r.reaction === 'resign' ? 'resigned' : r.reaction === 'join-other-party' ? 'joined-other-party' : 'independent') as Member['status']
        : m.status,
    };
  });
  const count = Object.keys(assignments).length;
  useGameStore.setState({
    assignments,
    members,
    popularity: Math.max(0, Math.min(100, Math.round((st.popularity + popDelta) * 10) / 10)),
    log: [...messages.reverse(), ...st.log].slice(0, 30),
    objectives: count === TOTAL_CONSTITUENCIES ? { ...st.objectives, 'assign-tickets': true } : st.objectives,
  });
  const bad = messages.filter((m) => !m.includes('accepted'));
  if (bad.length) st.showToast(bad[0]);
}

/** Everything the election rules need, taken from the current game state. */
type CtxSource = Pick<GameState, 'seed' | 'clock' | 'constituencies' | 'members' | 'assignments' | 'party' | 'popularity' | 'campaign' | 'term' | 'election' | 'government' | 'opposition'>;

/** The party that ran the last government, if it was a rival, and how the public felt about it. */
function incumbentOf(s: Pick<GameState, 'election' | 'opposition'>): { id: string; approval: number } | undefined {
  const g = s.election?.government;
  if (!g || g.leaderId === PLAYER_ID) return undefined;
  return { id: g.leaderId, approval: s.opposition?.rulingApproval ?? 50 };
}

/** Each election gets its own luck, but the same election always gets the same luck. */
function termSeed(seed: number, term: TermState): number {
  return term.number === 1 ? seed : (seed ^ hashString(`term:${term.number}`)) >>> 0;
}

export function buildElectionContext(s: CtxSource): ElectionContext {
  return {
    seed: termSeed(s.seed, s.term), day: s.clock.day, constituencies: s.constituencies, members: s.members, assignments: s.assignments,
    rivals: generateRivals(s.seed, s.term.number, incumbentOf(s)),
    player: { name: s.party.name, abbreviation: s.party.abbreviation, color: s.party.color, ideology: partyIdeology(s.members, s.assignments), popularity: Math.max(0, Math.min(100, s.popularity + electionEffect(s.government))) },
    campaign: s.campaign,
  };
}

/** What the government rules need, or null if the player is not running a government. */
export function buildGovContext(s: CtxSource): GovContext | null {
  if (!s.election || s.election.stage !== 'formed' || !canRun(s.election.government)) return null;
  const ec = buildElectionContext(s);
  const ideologies: GovContext['ideologies'] = { [PLAYER_ID]: ec.player.ideology, [IND_ID]: 'centrist-governance' };
  for (const r of ec.rivals) ideologies[r.id] = r.ideology;
  return { seed: s.seed, government: s.election.government, result: s.election.result, ideologies, members: s.members };
}

/** Starts the player's government on `day` if the election outcome makes them leader. */
function beginGovernment(outcome: ElectionOutcome, day: number, popularity: number): GovState | null {
  return outcome.government && canRun(outcome.government) ? startGovernment(outcome.government, day, popularity) : null;
}

/** Starts the opposition track when the player ends up on the opposition benches. */
function beginOpposition(outcome: ElectionOutcome, day: number): OppositionState | null {
  return outcome.government?.playerRole === 'opposition' ? startOpposition(day) : null;
}

function withLatestGovernment(past: PastElection[], g: { leaderId: string; playerRole: PastElection['playerRole'] }): PastElection[] {
  if (past.length === 0) return past;
  const last = past[past.length - 1];
  return [...past.slice(0, -1), { ...last, leaderId: g.leaderId, playerRole: g.playerRole }];
}

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.round(n * 10) / 10));

/** Starts a new election cycle: fresh campaign, tickets to reassign, older members. */
function beginCycle(term: TermState, message: string, rollMembers: boolean): void {
  const s = useGameStore.getState();
  useGameStore.setState({
    term,
    campaign: emptyCampaign(),
    assignments: {},
    members: rollMembers ? rolloverMembers(s.members) : s.members,
    popularity: rollMembers ? carryPopularity(s.popularity, s.government, s.opposition) : s.popularity,
    log: [message, ...s.log].slice(0, 30),
  });
  s.showToast(message);
}

/**
 * Catches the world up to the current day: government months, opposition months, party donations,
 * and the start of the next election cycle. Safe to call at any time.
 */
function syncWorld(): void {
  let s = useGameStore.getState();
  const day = s.clock.day;

  // Government months (crises, economy, coalition mood)
  if (s.government && s.government.status === 'governing') {
    const ctx = buildGovContext(s);
    if (ctx) {
      const { state, reports, events: daily } = advanceGovernment(s.government, ctx, day);
      if (reports.length === 0 && state !== s.government) {
        useGameStore.setState({ government: state, log: [...daily.slice(-3).reverse(), ...s.log].slice(0, 30) });
        if (daily.length) s.showToast(daily[daily.length - 1]);
        s = useGameStore.getState();
      }
      if (reports.length > 0) {
        const events = [...reports.flatMap((r) => r.events), ...daily];
        // Party popularity follows how the government is doing.
        let pop = s.popularity;
        for (let i = 0; i < reports.length; i++) pop += (state.approval - pop) * 0.08;
        useGameStore.setState({ government: state, popularity: clampPct(pop), log: [...events.slice(-3).reverse(), ...s.log].slice(0, 30) });
        if (events.length) s.showToast(events[events.length - 1]);
        s = useGameStore.getState();
      }
    }
  }

  // Opposition months
  if (s.opposition && !s.opposition.rulingFallen) {
    const { state, reports } = advanceOpposition(s.opposition, s.seed, day);
    if (reports.length > 0) {
      const events = reports.flatMap((r) => r.events);
      let pop = s.popularity;
      for (let i = 0; i < reports.length; i++) pop += (popularityTarget(state) - pop) * 0.05;
      useGameStore.setState({ opposition: state, popularity: clampPct(pop), log: [...events.slice(-3).reverse(), ...s.log].slice(0, 30) });
      if (events.length) s.showToast(events[events.length - 1]);
      s = useGameStore.getState();
    }
  }

  // Party donations, once the first election is over
  if (s.term.held || s.term.number > 1) {
    const months = incomeMonths(s.incomeDay, day);
    if (months > 0) {
      const per = monthlyDonations(s.popularity, s.government?.status === 'governing');
      useGameStore.setState({ funds: Math.round((s.funds + per * months) * 100) / 100, incomeDay: s.incomeDay + months * 30 });
      s = useGameStore.getState();
    }
  }

  // Next election cycle
  if (cycleDue(s.term, day) && s.election) {
    if (s.election.stage === 'hung') s.joinOpposition();
    s = useGameStore.getState();
    const next = advanceTerm(s.term);
    beginCycle(next, `The campaign for election ${next.number} has begun. Election day is Day ${next.electionDay}. Tickets must be assigned again.`, true);
  }
}

/** A government decision made while a crowd is outside changes its mood. */
function noteDecision(d: Decision): void {
  const s = useGameStore.getState();
  const a = s.government?.protests.active;
  if (!s.government || !a || a.status !== 'open') return;
  const r = decisionReaction(a.cause, d);
  if (!r.reaction) return;
  const active = { ...a, intensity: Math.max(0, Math.min(100, a.intensity + r.intensity)) };
  useGameStore.setState({
    government: { ...s.government, protests: { ...s.government.protests, active } },
    crowdReaction: { seq: (s.crowdReaction?.seq ?? 0) + 1, kind: r.reaction },
  });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useGameStore = create<GameState>((set, get) => ({
  screen: 'menu',
  player: { name: 'Arjun Rao', pronouns: 'he/him' },
  party: { name: 'Bharat Vikas Dal', abbreviation: 'BVD', color: '#ff9f1c' },
  clock: createClock(),
  speed: 1,
  funds: START_PARTY_FUNDS_CRORE,
  popularity: START_POPULARITY,
  objectives: {},
  position: SPAWN,
  panel: null,
  dialogue: null,
  toast: null,
  quality: isCoarse ? 'low' : 'medium',
  sessionId: 0,
  seed: 1,
  members: generateMembers(1),
  constituencies: generateConstituencies(1),
  assignments: {},
  log: [],
  campaign: emptyCampaign(),
  election: null,
  government: null,
  term: firstTerm(),
  pastElections: [],
  opposition: null,
  incomeDay: 1,
  crowdReaction: null,
  preElectionAlliances: [],
  lastVote: null,
  seatSharing: {},

  goTo: (screen) => set({ screen }),

  startNewGame: (player, party) =>
    set((s) => {
      const seed = (Date.now() % 2147483647) + 1;
      return {
      seed,
      members: generateMembers(seed),
      constituencies: generateConstituencies(seed),
      assignments: {},
      log: [],
      campaign: emptyCampaign(),
      election: null,
      government: null,
      term: firstTerm(),
      pastElections: [],
      opposition: null,
      incomeDay: 1,
      crowdReaction: null,
      preElectionAlliances: [],
      lastVote: null,
      seatSharing: {},
      screen: 'playing',
      player,
      party,
      clock: createClock(),
      speed: 1,
      funds: START_PARTY_FUNDS_CRORE,
      popularity: START_POPULARITY,
      objectives: {},
      position: SPAWN,
      panel: null,
      dialogue: null,
      sessionId: s.sessionId + 1,
      };
    }),

  applySave: (d) =>
    set((s) => ({
      screen: 'playing',
      player: d.player,
      party: d.party,
      clock: d.clock,
      speed: 1,
      funds: d.funds,
      popularity: d.popularity,
      objectives: d.objectives,
      position: d.position,
      seed: d.seed,
      members: d.members,
      constituencies: generateConstituencies(d.seed),
      assignments: d.assignments,
      log: d.log,
      campaign: d.campaign,
      election: d.election,
      government: d.government,
      term: d.term,
      pastElections: d.pastElections,
      opposition: d.opposition,
      incomeDay: d.incomeDay,
      crowdReaction: null,
      preElectionAlliances: [],
      lastVote: null,
      seatSharing: d.seatSharing ?? {},
      panel: null,
      dialogue: null,
      sessionId: s.sessionId + 1,
    })),

  toSaveData: () => {
    const s = get();
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      player: s.player,
      party: s.party,
      clock: s.clock,
      funds: s.funds,
      popularity: s.popularity,
      position: s.position,
      objectives: s.objectives,
      seed: s.seed,
      members: s.members,
      assignments: s.assignments,
      log: s.log,
      campaign: s.campaign,
      election: s.election,
      government: s.government,
      term: s.term,
      pastElections: s.pastElections,
      opposition: s.opposition,
      incomeDay: s.incomeDay,
      seatSharing: s.seatSharing,
    };
  },

  setPanel: (panel) =>
    set((s) => ({
      panel,
      ...(panel !== 'dialogue' ? { dialogue: null } : {}),
      ...(panel === 'candidates' && !s.objectives['open-candidates'] ? { objectives: { ...s.objectives, 'open-candidates': true } } : {}),
    })),
  togglePanel: (panel) => set((s) => ({ panel: s.panel === panel ? null : s.panel === null ? panel : s.panel })),

  tick: (realSeconds) => {
    const s = get();
    if (s.screen !== 'playing' || s.panel === 'pause') return;
    const clock = advanceClock(s.clock, realSeconds, s.speed);
    set({ clock });
    if (clock.day !== s.clock.day) syncWorld();
    if (!s.term.held && s.clock.day < s.term.electionDay && clock.day >= s.term.electionDay) get().showToast('Election day! Visit the Election Commission office or your dashboard.');
  },

  setSpeed: (speed) => set({ speed }),
  skipDay: () => {
    const s = get();
    const clock = skipToNextMorning(s.clock);
    set({ clock });
    syncWorld();
    if (!s.term.held && s.clock.day < s.term.electionDay && clock.day >= s.term.electionDay) get().showToast('Election day! Visit the Election Commission office or your dashboard.');
  },

  completeObjective: (id) =>
    set((s) => (s.objectives[id] ? s : { objectives: { ...s.objectives, [id]: true } })),

  openDialogue: (id) => {
    const d = DIALOGUES[id];
    if (!d) return;
    set({ panel: 'dialogue', dialogue: { id, nodeId: d.start } });
  },

  chooseDialogue: (choice) => {
    const s = get();
    if (!s.dialogue) return;
    const node = DIALOGUES[s.dialogue.id]?.nodes[s.dialogue.nodeId];
    const idx = node ? node.choices.indexOf(choice) : -1;
    const key = `seen:${s.dialogue.id}:${s.dialogue.nodeId}:${idx}`;
    const updates: Partial<GameState> = {};
    const objectives = { ...s.objectives };
    if (choice.effect?.completeObjective) objectives[choice.effect.completeObjective] = true;
    if (choice.effect?.popularity && !objectives[key]) {
      objectives[key] = true; // each popularity reward can only be earned once
      updates.popularity = Math.min(100, Math.max(0, s.popularity + choice.effect.popularity));
    }
    updates.objectives = objectives;
    if (choice.next && DIALOGUES[s.dialogue.id]?.nodes[choice.next]) {
      updates.dialogue = { id: s.dialogue.id, nodeId: choice.next };
    } else {
      updates.dialogue = null;
      updates.panel = null;
    }
    set(updates);
  },

  viewMember: (memberId) => {
    const s = get();
    if (!s.objectives['review-candidates'] && s.members.some((m) => m.id === memberId)) set({ objectives: { ...s.objectives, 'review-candidates': true } });
  },

  assignCandidate: (memberId, constituencyId) => {
    const s = get();
    const filled = !!s.assignments[constituencyId];
    const res = filled
      ? replaceTicket(s.assignments, s.members, s.constituencies, memberId, constituencyId)
      : assignTicket(s.assignments, s.members, s.constituencies, memberId, constituencyId);
    if (!res.ok) { get().showToast(res.error); return; }
    // Anyone who expected this seat (senior, ambitious, unassigned) may react, plus whoever was displaced.
    const affected = new Set<string>();
    if (res.displaced) affected.add(res.displaced);
    s.members
      .filter((m) => m.status === 'active' && m.id !== memberId && m.preferredConstituency === constituencyId && m.experience >= 15 && m.ambition >= 60 && !Object.values(res.assignments).includes(m.id))
      .sort((a, b) => b.experience - a.experience)
      .slice(0, 3)
      .forEach((m) => affected.add(m.id));
    applyReactions(res.assignments, [...affected], constituencyId);
  },

  removeCandidate: (constituencyId) => {
    const s = get();
    const res = removeTicket(s.assignments, constituencyId);
    if (!res.ok) { get().showToast(res.error); return; }
    applyReactions(res.assignments, res.displaced ? [res.displaced] : [], constituencyId);
  },

  autoAssignAll: () => {
    const s = get();
    const before = Object.keys(s.assignments).length;
    const next = autoAssign(s.assignments, s.members, s.constituencies);
    const count = Object.keys(next).length;
    set({
      assignments: next,
      log: [`Auto-selection filled ${count - before} seats (${count}/${TOTAL_CONSTITUENCIES}).`, ...s.log].slice(0, 30),
      objectives: count === TOTAL_CONSTITUENCIES ? { ...s.objectives, 'assign-tickets': true } : s.objectives,
    });
  },

  rallyAt: (constituencyId) => {
    const s = get();
    if (s.term.held) { s.showToast('The election is over.'); return; }
    const r = holdRally(s.funds, s.campaign, s.clock.day, s.constituencies, s.assignments, constituencyId, windowOf(s.term));
    if (!r.ok) { s.showToast(r.error); return; }
    set({ funds: r.funds, campaign: r.campaign, objectives: { ...s.objectives, 'run-campaign': true } });
  },

  adsAt: (constituencyId, amount) => {
    const s = get();
    if (s.term.held) { s.showToast('The election is over.'); return; }
    const r = buyLocalAds(s.funds, s.campaign, s.clock.day, s.constituencies, s.assignments, constituencyId, amount, windowOf(s.term));
    if (!r.ok) { s.showToast(r.error); return; }
    set({ funds: r.funds, campaign: r.campaign, objectives: { ...s.objectives, 'run-campaign': true } });
  },

  nationalAds: (amount) => {
    const s = get();
    if (s.term.held) { s.showToast('The election is over.'); return; }
    const r = buyNationalAds(s.funds, s.campaign, s.clock.day, amount, windowOf(s.term));
    if (!r.ok) { s.showToast(r.error); return; }
    set({ funds: r.funds, campaign: r.campaign, objectives: { ...s.objectives, 'run-campaign': true } });
  },

  jumpToDay: (day) => {
    const s = get();
    const t = s.term;
    if (t.held || !Number.isInteger(day) || day <= s.clock.day || day > t.electionDay) return;
    set({ clock: { day, minutes: 6 * 60 } });
    syncWorld();
    if (day >= t.electionDay) s.showToast('Election day! Hold the election from the Election Centre.');
    else if (day >= t.campaignStartDay && s.clock.day < t.campaignStartDay) s.showToast('The campaign season has begun.');
  },

  proposeAlliance: (partyId) => {
    const s = get();
    if (s.term.held) { s.showToast('Pre-election alliances are closed after voting.'); return; }
    if (s.preElectionAlliances.includes(partyId)) { s.showToast('That party is already in your pre-election alliance.'); return; }
    const ctx = buildElectionContext(s); const rival = ctx.rivals.find((r) => r.id === partyId);
    if (!rival) return;
    const fit = compatibility(partyIdeology(s.members, s.assignments), rival.ideology);
    const probability = Math.max(15, Math.min(90, Math.round(48 + fit * 28 + (s.popularity - rival.strength) * 0.25)));
    const accepted = ((s.seed ^ s.clock.day ^ partyId.length) % 100 + 100) % 100 < probability;
    if (!accepted) { s.showToast(`${rival.name} rejected the proposal (${probability}% acceptance chance).`); return; }
    set({ preElectionAlliances: [...s.preElectionAlliances, partyId], popularity: Math.min(100, s.popularity + 2), log: [`Pre-election alliance agreed with ${rival.name}. Seat-sharing and joint campaigning are unlocked.`, ...s.log].slice(0, 30) });
    s.showToast(`${rival.name} accepted your pre-election alliance (${probability}% probability).`);
  },

  setSeatShare: (constituencyId, partyId) => {
    const s = get();
    if (s.term.held || !s.preElectionAlliances.includes(partyId)) { s.showToast('Agree an alliance before allocating seats.'); return; }
    if (!s.assignments[constituencyId]) { s.showToast('Assign your party candidate first, then offer the seat.'); return; }
    const next = { ...s.seatSharing, [constituencyId]: partyId };
    const assignments = { ...s.assignments }; delete assignments[constituencyId];
    set({ seatSharing: next, assignments, log: [`Seat-sharing agreement: ${constituencyId} reserved for ${partyId}.`, ...s.log].slice(0, 30) });
    s.showToast(`${constituencyId} offered to ${partyId}; your party will not contest it.`);
  },
  openWarRoom: () => { set({ panel: 'war-room' }); },

  holdElection: () => {
    const s = get();
    if (s.term.held) { s.showToast('This election has already been held.'); return; }
    if (s.clock.day < s.term.electionDay) { s.showToast(`Voting opens on Day ${s.term.electionDay}.`); return; }
    const ctx = buildElectionContext(s);
    const result = runElection(ctx);
    const government = resolveElection(result, ctx.rivals, ctx.player, ctx.seed);
    const outcome: ElectionOutcome = { result, stage: government ? 'formed' : 'hung', government };
    const mine = result.seats[PLAYER_ID] ?? 0;
    const early = s.term.electionDay - s.term.campaignStartDay < CAMPAIGN_LEAD_DAYS;
    const lines = [
      government
        ? government.playerRole === 'leader' ? `${s.party.name} won a majority with ${mine} seats.` : `${ctx.rivals.find((r) => r.id === government.leaderId)?.name ?? 'A rival'} won a majority. You lead the opposition with ${mine} seats.`
        : `Hung parliament: ${s.party.name} won ${mine} of 180 seats and nobody has 91.`,
      `Turnout was ${result.turnout}% (${result.totalCast.toLocaleString()} votes counted).`,
    ];
    const past: PastElection = {
      term: s.term.number, day: s.clock.day, seats: result.seats, voteShare: result.voteShare,
      leaderId: government?.leaderId ?? null, playerRole: government?.playerRole ?? null, early,
    };
    set({
      members: applyResultsToMembers(s.members, s.assignments, result),
      election: outcome,
      government: (() => { const g = beginGovernment(outcome, s.clock.day, s.popularity); return g ? { ...g, switchingRequests: seedSwitchingRequests(buildGovContext({ ...s, election: outcome, government: g })!, s.members), meetings: seedMeetings(buildGovContext({ ...s, election: outcome, government: g })!) } : g; })(),
      opposition: beginOpposition(outcome, s.clock.day),
      term: markHeld(s.term, s.clock.day),
      pastElections: [...s.pastElections, past],
      incomeDay: s.clock.day,
      log: [...lines, ...s.log].slice(0, 30),
      objectives: { ...s.objectives, 'win-election': true, ...(s.term.number >= 2 ? { 'second-election': true } : {}), ...(government ? { 'form-government': true } : {}) },
    });
  },

  negotiateCoalition: (partnerIds) => {
    const s = get();
    if (!s.election || s.election.stage !== 'hung') return;
    const ctx = buildElectionContext(s);
    const r = formCoalition(s.election.result, ctx.rivals, ctx.player, s.seed, partnerIds);
    if (!r.ok) { s.showToast(r.error); return; }
    const formed: ElectionOutcome = { ...s.election, stage: 'formed', government: r.government };
    set({
      election: formed,
      government: (() => { const g = beginGovernment(formed, s.clock.day, s.popularity); return g ? { ...g, switchingRequests: seedSwitchingRequests(buildGovContext({ ...s, election: formed, government: g })!, s.members), meetings: seedMeetings(buildGovContext({ ...s, election: formed, government: g })!) } : g; })(),
      opposition: null,
      pastElections: withLatestGovernment(s.pastElections, r.government),
      log: [r.government.playerRole === 'leader' ? 'You formed a coalition government.' : 'You joined a coalition government as a junior partner.', ...s.log].slice(0, 30),
      objectives: { ...s.objectives, 'form-government': true },
    });
  },

  breakAlliance: (partnerId) => {
    const s = get(); const ctx = buildGovContext(s);
    if (!s.government || !ctx) return;
    const leavingAsPlayer = s.election?.government?.playerRole === 'partner' && partnerId === PLAYER_ID;
    const r = breakAlliance(s.government, ctx, partnerId, s.clock.day);
    if (!r.ok) { s.showToast(r.error); return; }
    if (leavingAsPlayer && s.election?.government) {
      const remainingSeats = [s.election.government.leaderId, ...r.state.partners].reduce((n, id) => n + (ctx.result.seats[id] ?? 0), 0);
      const updatedGovernment = { ...s.election.government, partners: r.state.partners, seats: remainingSeats, playerRole: 'opposition' as const };
      set({ election: { ...s.election, government: updatedGovernment }, government: null, opposition: startOpposition(s.clock.day), log: ['Your party left the ruling coalition and moved to the opposition benches.', r.message, ...s.log].slice(0, 30) });
      s.showToast('Alliance ended. Opposition gameplay is now available.');
      return;
    }
    set({ government: r.state, log: [r.message, ...s.log].slice(0, 30) }); s.showToast(r.message);
  },
  resolveSwitch: (requestId, decision) => {
    const s = get(); if (!s.government) return;
    const req = s.government.switchingRequests.find((x) => x.id === requestId);
    if (!req || req.status !== 'pending') return;
    if (decision === 'reject') { set({ government: { ...s.government, switchingRequests: s.government.switchingRequests.map((x) => x.id === requestId ? { ...x, status: 'rejected' } : x) } }); return; }
    const r = req.direction === 'in' ? applyIncomingSwitch(s.government, req, s.clock.day, decision === 'negotiate') : applyOutgoingSwitch(s.government, req, s.clock.day);
    if (!r.ok) { s.showToast(r.error); return; }
    const members = req.direction === 'out' && req.memberId ? s.members.map((m) => m.id === req.memberId ? { ...m, status: 'joined-other-party' as const, loyalty: Math.max(0, m.loyalty - 15) } : m) : s.members;
    set({ government: { ...r.state, switchingRequests: r.state.switchingRequests.map((x) => x.id === requestId ? { ...x, status: decision === 'negotiate' ? 'negotiated' : 'accepted' } : x) }, members, log: [r.message, ...s.log].slice(0, 30) }); s.showToast(r.message);
  },
  recruitMembers: (method) => {
    const s = get();
    const plans: Record<RecruitmentMethod, { cost: number; gain: number; label: string }> = {
      'membership-campaign': { cost: 8, gain: 35, label: 'membership campaign' },
      'youth-program': { cost: 5, gain: 25, label: 'youth political programme' },
      'local-office': { cost: 3, gain: 12, label: 'local party office drive' },
      'door-to-door': { cost: 6, gain: 20, label: 'door-to-door campaign' },
      'social-media': { cost: 7, gain: 30, label: 'social media campaign' },
      'recruit-politician': { cost: 12, gain: 5, label: 'experienced politician outreach' },
    };
    const plan = plans[method];
    if (s.funds < plan.cost) { s.showToast(`You need ₹${plan.cost} crore for a ${plan.label}.`); return; }
    const newcomers = generateAdditionalMembers(s.seed ^ s.clock.day ^ s.members.length, s.members.length + 1, plan.gain);
    const clock = { day: s.clock.day + 7, minutes: 6 * 60 };
    set({ funds: s.funds - plan.cost, members: [...s.members, ...newcomers], clock, log: [`${plan.label} recruited ${plan.gain} new party members. The campaign took one week.`, ...s.log].slice(0, 30) });
    s.showToast(`Recruitment complete: +${plan.gain} party members.`);
  },

  manageMinistry: (ministryId, action) => {
    const s = get(); const ctx = buildGovContext(s);
    if (!s.government || !ctx) return;
    const r = manageMinistry(s.government, ctx, ministryId, action, s.clock.day);
    if (!r.ok) { s.showToast(r.error); return; }
    set({ government: r.state, log: [r.message, ...s.log].slice(0, 30) }); s.showToast(r.message);
  },
  requestMeeting: () => {
    const s = get();
    const ctx = buildGovContext(s);
    if (!s.government || !ctx) return;
    const rival = Object.keys(ctx.result.seats).find((id) => id !== PLAYER_ID && (ctx.result.seats[id] ?? 0) > 0) ?? IND_ID;
    const id = `meeting-player-${s.clock.day}-${s.government.meetings.length}`;
    const meeting = { id, fromPartyId: rival, personName: 'Your political outreach', topic: 'policy' as const, trust: 50, offer: 'You requested a private discussion on policy cooperation.', status: 'pending' as const };
    set({ government: { ...s.government, meetings: [...s.government.meetings, meeting] }, log: ['You initiated a private political meeting.', ...s.log].slice(0, 30) });
    s.showToast('Private meeting requested.');
  },
  resolveMeeting: (meetingId, decision) => {
    const s = get();
    if (!s.government) return;
    const r = resolveMeeting(s.government, meetingId, decision, s.clock.day);
    if (!r.ok) { s.showToast(r.error); return; }
    set({ government: r.state, log: [r.message, ...s.log].slice(0, 30) });
    s.showToast(r.message);
  },
  resign: (memberId) => {
    const s = get(); if (!s.government) return;
    const member = s.members.find((m) => m.id === memberId); if (!member) return;
    set({ government: resignMinister(s.government, memberId, s.clock.day), members: s.members.map((m) => m.id === memberId ? { ...m, status: 'resigned' as const } : m), log: [`${member.name} resigned from the cabinet.`, ...s.log].slice(0, 30) });
  },
  joinOpposition: () => {
    const s = get();
    if (!s.election || s.election.stage !== 'hung') return;
    const ctx = buildElectionContext(s);
    const government = autoGovernment(s.election.result, ctx.rivals, ctx.player, s.seed, true);
    const name = ctx.rivals.find((r) => r.id === government.leaderId)?.name ?? 'A rival party';
    set({
      election: { ...s.election, stage: 'formed', government },
      opposition: startOpposition(s.clock.day),
      pastElections: withLatestGovernment(s.pastElections, government),
      log: [`${name} formed a ${government.type} government. You lead the opposition.`, ...s.log].slice(0, 30),
      objectives: { ...s.objectives, 'form-government': true },
    });
  },

  setTax: (key, value) => {
    const s = get();
    if (!s.government) return;
    const r = setTaxes(s.government, { ...s.government.taxes, [key]: value });
    if (!r.ok) { s.showToast(r.error); return; }
    set({ government: r.state });
    noteDecision({ kind: 'tax', key, delta: value - s.government.taxes[key] });
  },

  setSector: (sector, amount) => {
    const s = get();
    if (!s.government) return;
    const r = setSpending(s.government, sector, amount);
    if (!r.ok) { s.showToast(r.error); return; }
    set({ government: r.state });
    noteDecision({ kind: 'spend', sector, delta: Math.round(amount) - s.government.spending[sector] });
  },

  appoint: (ministryId, memberId) => {
    const s = get();
    const ctx = buildGovContext(s);
    if (!s.government || !ctx || s.government.status !== 'governing') return;
    const owners = ministryOwners({ ...ctx.government, partners: s.government.partners });
    const r = appointMinister(s.government.cabinet, s.members, owners, ministryId, memberId);
    if (!r.ok) { s.showToast(r.error); return; }
    set({ government: { ...s.government, cabinet: r.cabinet }, objectives: { ...s.objectives, 'appoint-cabinet': true } });
  },

  dismiss: (ministryId) => {
    const s = get();
    if (!s.government || s.government.status !== 'governing') return;
    const r = dismissMinister(s.government.cabinet, ministryId);
    if (!r.ok) { s.showToast(r.error); return; }
    set({ government: { ...s.government, cabinet: r.cabinet } });
  },

  autoCabinetAll: () => {
    const s = get();
    const ctx = buildGovContext(s);
    if (!s.government || !ctx || s.government.status !== 'governing') return;
    const owners = ministryOwners({ ...ctx.government, partners: s.government.partners });
    set({ government: { ...s.government, cabinet: autoCabinet(s.members, owners, s.government.cabinet) }, objectives: { ...s.objectives, 'appoint-cabinet': true } });
  },

  propose: (billId) => {
    const s = get();
    const ctx = buildGovContext(s);
    if (!s.government || !ctx) return;
    const r = proposeBill(s.government, ctx, billId, s.clock.day);
    if (!r.ok) { s.showToast(r.error); return; }
    set({
      government: r.outcome.state,
      lastVote: r.outcome.vote,
      objectives: r.outcome.passed ? { ...s.objectives, 'pass-bill': true } : s.objectives,
      log: [r.outcome.message, ...s.log].slice(0, 30),
    });
    s.showToast(r.outcome.message);
    noteDecision({ kind: 'bill', id: billId, passed: r.outcome.passed });
  },

  skipDays: (n) => {
    const s = get();
    if (!Number.isInteger(n) || n < 1 || n > 365) return;
    set({ clock: { day: s.clock.day + n, minutes: 6 * 60 } });
    syncWorld();
  },

  respond: (optionIdx) => {
    const s = get();
    const ctx = buildGovContext(s);
    if (!s.government || !ctx) return;
    const r = respondToCrisis(s.government, ctx, optionIdx, s.clock.day);
    if (!r.ok) { s.showToast(r.error); return; }
    set({ government: r.state, objectives: { ...s.objectives, 'handle-crisis': true }, log: [r.message, ...s.log].slice(0, 30) });
    s.showToast(r.message);
    syncWorld(); // months that were waiting on the crisis can now run
  },

  respondProtest: (optionIdx, police) => {
    const s = get();
    if (!s.government) return;
    const r = respondToProtest(s.government, s.seed, optionIdx, police, s.clock.day);
    if (!r.ok) { s.showToast(r.error); return; }
    set({
      government: r.state,
      objectives: { ...s.objectives, 'handle-protest': true },
      log: [r.message, ...s.log].slice(0, 30),
      crowdReaction: { seq: (s.crowdReaction?.seq ?? 0) + 1, kind: r.reaction },
    });
    s.showToast(r.message);
    syncWorld();
  },

  oppose: (id) => {
    const s = get();
    if (!s.opposition) return;
    const r = takeOppositionAction(s.opposition, s.funds, s.seed, id, s.clock.day);
    if (!r.ok) { s.showToast(r.error); return; }
    set({ opposition: r.state, funds: r.funds, popularity: clampPct(s.popularity + r.popularityDelta), log: [r.message, ...s.log].slice(0, 30) });
    s.showToast(r.message);
  },

  noConfidence: () => {
    const s = get();
    if (!s.opposition || !s.election?.government) return;
    const ec = buildElectionContext(s);
    const ideologies: Record<string, Ideology> = { [PLAYER_ID]: ec.player.ideology, [IND_ID]: 'centrist-governance' };
    for (const r of ec.rivals) ideologies[r.id] = r.ideology;
    const r = moveNoConfidence(s.opposition, { seed: ec.seed, government: s.election.government, seats: s.election.result.seats, ideologies }, s.clock.day);
    if (!r.ok) { s.showToast(r.error); return; }
    set({
      opposition: r.outcome.state,
      popularity: clampPct(s.popularity + (r.outcome.passed ? 2 : -2)),
      objectives: { ...s.objectives, 'move-motion': true },
      log: [r.outcome.message, ...s.log].slice(0, 30),
    });
    s.showToast(r.outcome.message);
  },

  callEarlyElection: () => {
    const s = get();
    const fallen = s.government?.status === 'fallen' || !!s.opposition?.rulingFallen;
    if (!fallen) { s.showToast('An early election needs the government to fall first.'); return; }
    if (!s.election) return;
    if (s.election.stage === 'hung') { s.showToast('Settle the coalition first.'); return; }
    const t = earlyTerm(s.term, s.clock.day);
    if (!s.term.held && t.electionDay >= s.term.electionDay) { s.showToast(`The election is already scheduled for Day ${s.term.electionDay}.`); return; }
    if (s.term.held) beginCycle(t, `Early election called for Day ${t.electionDay}. Tickets must be assigned again.`, true);
    else {
      set({ term: t, log: [`The election has been moved forward to Day ${t.electionDay}.`, ...s.log].slice(0, 30) });
      s.showToast(`The election has been moved forward to Day ${t.electionDay}.`);
    }
  },

  setPosition: (position) => set({ position }),

  showToast: (toast) => {
    set({ toast });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 2600);
  },

  setQuality: (quality) => set({ quality }),
}));
