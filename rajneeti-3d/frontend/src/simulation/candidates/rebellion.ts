import { Rng } from '../core/rng';
import type { Member } from '../parties/types';

export type Reaction = 'accept' | 'reconsideration' | 'dissatisfied' | 'internal-opposition' | 'resign' | 'join-other-party' | 'independent';
export type Difficulty = 'easy' | 'normal' | 'realistic';

export interface ReactionResult {
  reaction: Reaction;
  loyaltyDelta: number;
  partyPopularityDelta: number;
  message: (name: string) => string;
}

const MULT: Record<Difficulty, number> = { easy: 0.7, normal: 1, realistic: 1.3 };
const clamp = (n: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, n));

/** How strongly a member resents being passed over (0..1). */
export function grievance(m: Member, difficulty: Difficulty): number {
  const raw = 0.4 * m.ambition + 0.3 * (100 - m.loyalty) + 0.2 * Math.min(100, m.experience * 3) - 0.2 * (m.relationshipWithPresident + 50);
  return clamp((raw / 90) * MULT[difficulty]);
}

/** Probabilistic reaction: personality decides the odds, and most members simply accept. */
export function reactToDenial(m: Member, rng: Rng, difficulty: Difficulty): ReactionResult {
  const g = grievance(m, difficulty);
  const reaction = rng.weighted<Reaction>([
    { item: 'accept', weight: 70 * (1 - g) + 5 },
    { item: 'reconsideration', weight: 20 },
    { item: 'dissatisfied', weight: 25 * g + 5 },
    { item: 'internal-opposition', weight: 25 * g * g },
    { item: 'resign', weight: 15 * g * g * (1 - m.loyalty / 120) },
    { item: 'join-other-party', weight: 15 * g * g * (m.ambition / 100) },
    { item: 'independent', weight: 12 * g * g * (m.popularity / 100) },
  ]);
  const lost = -(0.3 + 0.7 * (m.popularity / 100));
  switch (reaction) {
    case 'accept': return { reaction, loyaltyDelta: 0, partyPopularityDelta: 0, message: (n) => `${n} accepted the decision.` };
    case 'reconsideration': return { reaction, loyaltyDelta: -2, partyPopularityDelta: 0, message: (n) => `${n} asked you to reconsider.` };
    case 'dissatisfied': return { reaction, loyaltyDelta: -8, partyPopularityDelta: 0, message: (n) => `${n} is openly dissatisfied.` };
    case 'internal-opposition': return { reaction, loyaltyDelta: -15, partyPopularityDelta: -0.2, message: (n) => `${n} is organising internal opposition.` };
    case 'resign': return { reaction, loyaltyDelta: -100, partyPopularityDelta: lost, message: (n) => `${n} resigned from the party.` };
    case 'join-other-party': return { reaction, loyaltyDelta: -100, partyPopularityDelta: lost, message: (n) => `${n} joined a rival party.` };
    case 'independent': return { reaction, loyaltyDelta: -100, partyPopularityDelta: lost, message: (n) => `${n} will contest as an independent.` };
  }
}

export const LEAVES_PARTY: ReadonlySet<Reaction> = new Set<Reaction>(['resign', 'join-other-party', 'independent']);
