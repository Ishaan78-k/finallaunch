export type Ideology =
  | 'economic-development' | 'social-welfare' | 'environmental-reform' | 'regional-development'
  | 'liberal-reform' | 'traditional-conservatism' | 'centrist-governance';

export type MemberStatus = 'active' | 'resigned' | 'joined-other-party' | 'independent';

export interface Member {
  id: string;
  name: string;
  age: number;
  experience: number; // years in politics
  education: string;
  preferredConstituency: string;
  popularity: number;
  loyalty: number;
  reputation: number;
  ambition: number;
  leadership: number;
  campaigning: number;
  previousMargin: number | null; // last election vote margin in points (+win / -loss), null = never contested
  relationshipWithPresident: number; // -50..50
  allies: string[];
  rivals: string[];
  ideology: Ideology;
  role: string;
  status: MemberStatus;
  opposesLeadership: boolean;
}

export type Profile = 'industrial' | 'agricultural' | 'university' | 'metro' | 'coastal' | 'hill';

export interface Constituency {
  id: string;
  name: string;
  region: string;
  population: number;
  eligibleVoters: number;
  classification: 'urban' | 'rural';
  profile: Profile;
  economy: number;
  education: number;
  employment: number;
  infrastructure: number;
  healthcare: number;
  historicalSupport: number; // % vote the player's party got here last time
  issues: string[];
}
