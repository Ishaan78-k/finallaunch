import type { Constituency, Member } from '../parties/types';

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));

/** 0-100 estimate of how well a member fits a constituency. */
export function suitability(m: Member, c: Constituency): number {
  const prev = m.previousMargin === null ? 50 : clamp(50 + m.previousMargin * 2);
  let score = 0.28 * m.popularity + 0.2 * m.reputation + 0.15 * m.campaigning + 0.1 * m.leadership + 0.1 * m.loyalty + 0.17 * prev;
  if (m.preferredConstituency === c.id) score += 8; // knows the area and wants it
  if (c.profile === 'university' && (m.education === 'PhD' || m.education.startsWith('Master'))) score += 5;
  if (c.classification === 'rural') score += (m.experience / 40) * 4; // experience counts for more in rural seats
  return Math.round(clamp(score) * 10) / 10;
}
