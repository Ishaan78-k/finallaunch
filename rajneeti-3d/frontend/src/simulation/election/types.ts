import type { Constituency, Ideology, Member } from '../parties/types';
import type { Assignments } from '../candidates/tickets';

export const PLAYER_ID = 'PLAYER';
export const IND_ID = 'IND';

export interface RivalParty {
  id: string;
  name: string;
  abbreviation: string;
  color: string;
  ideology: Ideology;
  /** National base strength, 0-100. */
  strength: number;
  /** region -> 0-100 local affinity */
  regionAffinity: Record<string, number>;
  personality: 'ambitious' | 'loyal' | 'aggressive' | 'ideological' | 'negotiator';
  negotiationSkill: number;
  ministryDemand: number;
}

export interface LocalCampaign { rallies: number; adSpend: number }
export interface CampaignState {
  /** Crore spent on national advertising. */
  nationalSpend: number;
  local: Record<string, LocalCampaign>;
  /** Crore spent on the whole campaign (for reporting). */
  totalSpent: number;
}

export interface PlayerSide {
  name: string;
  abbreviation: string;
  color: string;
  ideology: Ideology;
  popularity: number;
}

export interface ElectionContext {
  seed: number;
  day: number;
  constituencies: Constituency[];
  members: Member[];
  assignments: Assignments;
  rivals: RivalParty[];
  player: PlayerSide;
  campaign: CampaignState;
}

export interface BallotEntry {
  /** PLAYER, a rival id, or `IND:<memberId>` for independents. */
  key: string;
  partyId: string;
  candidateName: string;
  votes: number;
  /** Percent of votes cast, one decimal. */
  share: number;
}

export interface ConstituencyResult {
  constituencyId: string;
  eligible: number;
  cast: number;
  /** Sorted by votes, highest first. */
  entries: BallotEntry[];
  winnerParty: string;
  /** Votes between first and second place (all votes if unopposed). */
  margin: number;
  playerContested: boolean;
}

export interface ElectionResult {
  seed: number;
  day: number;
  constituencies: ConstituencyResult[];
  /** partyId -> seats. Always sums to the number of constituencies. */
  seats: Record<string, number>;
  /** partyId -> votes. */
  votes: Record<string, number>;
  /** partyId -> national vote share percent, one decimal. */
  voteShare: Record<string, number>;
  totalCast: number;
  turnout: number;
}

export type PlayerRole = 'leader' | 'partner' | 'opposition';

export interface Government {
  type: 'majority' | 'coalition' | 'minority';
  leaderId: string;
  partners: string[];
  seats: number;
  /** partyId -> ministries out of 12. */
  ministries: Record<string, number>;
  playerRole: PlayerRole;
}

export interface ElectionOutcome {
  result: ElectionResult;
  /** 'hung' = nobody has a majority and the player must negotiate or sit in opposition. */
  stage: 'hung' | 'formed';
  government: Government | null;
}
