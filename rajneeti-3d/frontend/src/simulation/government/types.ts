import type { Ideology } from '../parties/types';
import type { ActiveCrisis, CrisisRecord } from '../world/crises';
import type { ProtestState } from '../world/protests';

export const SECTORS = ['health', 'education', 'infrastructure', 'welfare', 'defence', 'agriculture', 'administration'] as const;
export type Sector = (typeof SECTORS)[number];

export interface Taxes { income: number; corporate: number; gst: number }

export interface Economy {
  /** National output in crore. */
  gdp: number;
  /** Yearly growth, percent. */
  growth: number;
  /** Yearly inflation, percent. */
  inflation: number;
  unemployment: number;
  /** Money owed, in crore. */
  debt: number;
}

export interface MinistryDef { id: string; name: string; sector: Sector | null }

/** Order matters: the leader's party takes the first posts, then partners get the rest. */
export const MINISTRY_DEFS: readonly MinistryDef[] = [
  { id: 'finance', name: 'Finance', sector: null },
  { id: 'home', name: 'Home Affairs', sector: 'administration' },
  { id: 'defence', name: 'Defence', sector: 'defence' },
  { id: 'external', name: 'External Affairs', sector: null },
  { id: 'health', name: 'Health', sector: 'health' },
  { id: 'education', name: 'Education', sector: 'education' },
  { id: 'infrastructure', name: 'Infrastructure', sector: 'infrastructure' },
  { id: 'welfare', name: 'Social Welfare', sector: 'welfare' },
  { id: 'agriculture', name: 'Agriculture', sector: 'agriculture' },
  { id: 'industry', name: 'Industry', sector: null },
  { id: 'environment', name: 'Environment', sector: null },
  { id: 'justice', name: 'Law and Justice', sector: 'administration' },
];

export type BillId = 'income-tax-cut' | 'gst-hike' | 'rural-jobs' | 'infrastructure-push' | 'anti-corruption' | 'labour-reform' | 'green-transition';

export interface BillRecord {
  billId: BillId;
  day: number;
  passed: boolean;
  yes: number;
  no: number;
  abstain: number;
}

export interface MeetingRequest {
  id: string;
  fromPartyId: string;
  personName: string;
  topic: 'support' | 'policy' | 'ministries';
  trust: number;
  offer: string;
  status: 'pending' | 'accepted' | 'rejected' | 'countered' | 'postponed';
}

export interface SwitchingRequest {
  id: string;
  direction: 'in' | 'out';
  politicianName: string;
  partyId: string;
  constituency: string;
  loyalty: number;
  reason: string;
  memberId?: string;
  status: 'pending' | 'accepted' | 'rejected' | 'negotiated';
}

export type MinistryAction = 'fund' | 'services' | 'recruit' | 'policy' | 'complaints';

export interface MinistryMetrics { performance: number; budget: number; complaints: number; ministerSatisfaction: number }

export interface GovState {
  startDay: number;
  /** Day of the last monthly update. */
  lastMonthDay: number;
  /** Cash in hand, crore. Never mixed with party funds. */
  treasury: number;
  taxes: Taxes;
  /** Monthly spending per sector, crore. */
  spending: Record<Sector, number>;
  economy: Economy;
  /** ministryId -> memberId, only for posts held by the player's party. */
  cabinet: Record<string, string>;
  /** partnerId -> 0..100. */
  satisfaction: Record<string, number>;
  /** Coalition partners still supporting the government. */
  partners: string[];
  /** Public approval of the government, 0..100. */
  approval: number;
  bills: BillRecord[];
  status: 'governing' | 'fallen';
  fallenReason: string | null;
  history: string[];
  /** A crisis waiting for a decision, if any. Months do not advance past it until it is handled or times out. */
  crisis: ActiveCrisis | null;
  /** Day the last crisis broke out, to space them apart. */
  lastCrisisDay: number;
  crisisLog: CrisisRecord[];
  /** Public protests, police response and government promises. */
  protests: ProtestState;
  /** Pending defections and switch requests shown in the Prime Minister's Office. */
  switchingRequests: SwitchingRequest[];
  /** Private political meetings awaiting a decision. */
  meetings: MeetingRequest[];
  /** Performance and complaints for each ministry. */
  ministryMetrics: Record<string, MinistryMetrics>;
  /** Ministries withdrawn from a junior partner by the Prime Minister/system. */
  ministryRemoved: string[];
}

export interface Bill {
  id: BillId;
  name: string;
  summary: string;
  leaning: Ideology;
  /** Approval change if it passes. */
  approval: number;
  tax?: Partial<Taxes>;
  /** Sector -> multiplier applied to monthly spending. */
  spend?: Partial<Record<Sector, number>>;
  /** Short-term effect on yearly growth target (percentage points). */
  growth?: number;
}

export const BILLS: readonly Bill[] = [
  { id: 'income-tax-cut', name: 'Income Tax Relief Act', summary: 'Cuts income tax by 2 points.', leaning: 'economic-development', approval: 3, tax: { income: -2 } },
  { id: 'gst-hike', name: 'GST Rationalisation Act', summary: 'Raises GST by 2 points. Brings in money, but prices rise.', leaning: 'centrist-governance', approval: -3, tax: { gst: 2 } },
  { id: 'rural-jobs', name: 'Rural Jobs Guarantee Act', summary: 'Raises welfare and agriculture spending by 15%.', leaning: 'social-welfare', approval: 4, spend: { welfare: 1.15, agriculture: 1.15 } },
  { id: 'infrastructure-push', name: 'National Infrastructure Mission', summary: 'Raises infrastructure spending by 25%.', leaning: 'regional-development', approval: 2, spend: { infrastructure: 1.25 }, growth: 0.2 },
  { id: 'anti-corruption', name: 'Public Integrity Act', summary: 'Strict anti-corruption watchdog. Popular, and trims administration waste.', leaning: 'liberal-reform', approval: 5, spend: { administration: 0.95 } },
  { id: 'labour-reform', name: 'Labour Codes Reform', summary: 'Makes hiring easier. Business likes it; unions do not.', leaning: 'economic-development', approval: -2, growth: 0.3 },
  { id: 'green-transition', name: 'Green Transition Act', summary: 'Funds clean energy. Costs money now, helps later.', leaning: 'environmental-reform', approval: 2, spend: { infrastructure: 1.1 }, growth: -0.1 },
];

export const BILL_BY_ID: Record<BillId, Bill> = Object.fromEntries(BILLS.map((b) => [b.id, b])) as Record<BillId, Bill>;

export const BILL_COOLDOWN_DAYS = 30;
export const MONTH_DAYS = 30;
export const TAX_LIMITS: Record<keyof Taxes, [number, number]> = { income: [0, 40], corporate: [10, 50], gst: [5, 28] };
export const DEFAULT_TAXES: Taxes = { income: 10, corporate: 25, gst: 12 };
export const DEFAULT_SPENDING: Record<Sector, number> = {
  health: 520, education: 560, infrastructure: 900, welfare: 700, defence: 800, agriculture: 520, administration: 500,
};
export const MIN_SPEND_RATIO = 0.4;
export const MAX_SPEND_RATIO = 2.0;
