import { MAJORITY_SEATS, MINISTRIES } from '../../data/constants';
import { Rng, hashString } from '../core/rng';
import type { Ideology } from '../parties/types';
import { apportion } from './model';
import { PLAYER_ID } from './types';
import type { ElectionResult, Government, PlayerSide, RivalParty } from './types';

/** Rough position on (economy: left -1 .. right +1, society: liberal -1 .. conservative +1). */
const COORD: Record<Ideology, [number, number]> = {
  'economic-development': [0.7, 0],
  'social-welfare': [-0.8, -0.2],
  'environmental-reform': [-0.3, -0.6],
  'regional-development': [0, 0.3],
  'liberal-reform': [0.5, -0.8],
  'traditional-conservatism': [0.4, 0.9],
  'centrist-governance': [0, 0],
};

/** 0 (opposites) .. 1 (same outlook). */
export function compatibility(a: Ideology, b: Ideology): number {
  const [ax, ay] = COORD[a];
  const [bx, by] = COORD[b];
  const d = Math.hypot(ax - bx, ay - by);
  return Math.round(Math.max(0, Math.min(1, 1 - d / 2.4)) * 100) / 100;
}

export interface Bloc { id: string; name: string; abbreviation: string; color: string; ideology: Ideology; seats: number }

/** Parties with at least one seat, largest first (ties: player first, then by id). Independents are not a bloc. */
export function standings(result: ElectionResult, rivals: RivalParty[], player: PlayerSide): Bloc[] {
  const blocs: Bloc[] = [
    { id: PLAYER_ID, name: player.name, abbreviation: player.abbreviation, color: player.color, ideology: player.ideology, seats: result.seats[PLAYER_ID] ?? 0 },
    ...rivals.map((r) => ({ id: r.id, name: r.name, abbreviation: r.abbreviation, color: r.color, ideology: r.ideology, seats: result.seats[r.id] ?? 0 })),
  ];
  return blocs
    .filter((b) => b.seats > 0)
    .sort((a, b) => b.seats - a.seats || (a.id === PLAYER_ID ? -1 : b.id === PLAYER_ID ? 1 : a.id.localeCompare(b.id)));
}

const WILLING_THRESHOLD = 38;

/** Would `partner` serve in a government led by `leader`? Same inputs always give the same answer. */
export function willingToJoin(seed: number, partner: Bloc, leader: Bloc): boolean {
  const jitter = (new Rng(seed ^ hashString(`${partner.id}>${leader.id}`)).next() * 2 - 1) * 8;
  return compatibility(partner.ideology, leader.ideology) * 100 + jitter >= WILLING_THRESHOLD;
}

export interface Offer { bloc: Bloc; compatibility: number; willing: boolean }

/** Each other party, with how well it matches the player and whether it would accept the player as leader. */
export function coalitionOffers(result: ElectionResult, rivals: RivalParty[], player: PlayerSide, seed: number): Offer[] {
  const blocs = standings(result, rivals, player);
  const me = blocs.find((b) => b.id === PLAYER_ID);
  return blocs
    .filter((b) => b.id !== PLAYER_ID)
    .map((b) => ({ bloc: b, compatibility: compatibility(b.ideology, player.ideology), willing: me ? willingToJoin(seed, b, me) : false }));
}

function shareMinistries(group: Bloc[]): Record<string, number> {
  const parts = apportion(MINISTRIES, group.map((b) => b.seats));
  const out: Record<string, number> = {};
  group.forEach((b, i) => { out[b.id] = parts[i]; });
  return out;
}

const roleOf = (leaderId: string, group: string[]): Government['playerRole'] =>
  leaderId === PLAYER_ID ? 'leader' : group.includes(PLAYER_ID) ? 'partner' : 'opposition';

function build(group: Bloc[], type: Government['type']): Government {
  const leader = group[0];
  return {
    type, leaderId: leader.id, partners: group.slice(1).map((b) => b.id),
    seats: group.reduce((s, b) => s + b.seats, 0), ministries: shareMinistries(group),
    playerRole: roleOf(leader.id, group.map((b) => b.id)),
  };
}

export type FormResult = { ok: true; government: Government } | { ok: false; error: string };

/** The player's party plus the chosen partners try to form a government. */
export function formCoalition(result: ElectionResult, rivals: RivalParty[], player: PlayerSide, seed: number, partnerIds: string[]): FormResult {
  const blocs = standings(result, rivals, player);
  const me = blocs.find((b) => b.id === PLAYER_ID);
  if (!me) return { ok: false, error: 'Your party won no seats, so it cannot form or join a government.' };
  const ids = [...new Set(partnerIds)].filter((id) => id !== PLAYER_ID);
  const partners: Bloc[] = [];
  for (const id of ids) {
    const b = blocs.find((x) => x.id === id);
    if (!b) return { ok: false, error: `Unknown or seatless party ${id}.` };
    partners.push(b);
  }
  const group = [me, ...partners].sort((a, b) => b.seats - a.seats || (a.id === PLAYER_ID ? -1 : b.id === PLAYER_ID ? 1 : a.id.localeCompare(b.id)));
  const total = group.reduce((s, b) => s + b.seats, 0);
  if (total < MAJORITY_SEATS) return { ok: false, error: `That group has ${total} seats; ${MAJORITY_SEATS} are needed for a majority.` };
  const leader = group[0];
  for (const b of group.slice(1)) {
    if (!willingToJoin(seed, b, leader)) return { ok: false, error: `${b.name} refuses to serve in a government led by ${leader.name}.` };
  }
  return { ok: true, government: build(group, group.length === 1 ? 'majority' : 'coalition') };
}

/**
 * How the rest of parliament forms a government when the player does not take part (or cannot).
 * A party with a majority simply governs. Otherwise the largest party recruits compatible, willing partners.
 */
export function autoGovernment(result: ElectionResult, rivals: RivalParty[], player: PlayerSide, seed: number, excludePlayer: boolean): Government {
  const blocs = standings(result, rivals, player).filter((b) => !(excludePlayer && b.id === PLAYER_ID));
  const solo = blocs.find((b) => b.seats >= MAJORITY_SEATS);
  if (solo) return build([solo], 'majority');
  for (const leader of blocs.slice(0, 2)) {
    const group = [leader];
    let seats = leader.seats;
    const pool = blocs
      .filter((b) => b.id !== leader.id && willingToJoin(seed, b, leader))
      .sort((a, b) => compatibility(b.ideology, leader.ideology) - compatibility(a.ideology, leader.ideology) || b.seats - a.seats);
    for (const p of pool) {
      if (seats >= MAJORITY_SEATS) break;
      group.push(p);
      seats += p.seats;
    }
    if (seats >= MAJORITY_SEATS) return build(group, 'coalition');
  }
  // Nobody can assemble a majority: the largest party governs alone, relying on outside support.
  if (blocs.length === 0) return { type: 'minority', leaderId: PLAYER_ID, partners: [], seats: 0, ministries: {}, playerRole: 'leader' };
  return build([blocs[0]], 'minority');
}

/** What happens right after the votes are counted. `government: null` means the player must negotiate. */
export function resolveElection(result: ElectionResult, rivals: RivalParty[], player: PlayerSide, seed: number): Government | null {
  const solo = standings(result, rivals, player).find((b) => b.seats >= MAJORITY_SEATS);
  if (!solo) return null;
  return build([solo], 'majority');
}
