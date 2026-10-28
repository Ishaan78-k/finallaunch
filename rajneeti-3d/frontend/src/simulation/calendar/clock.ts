import { ELECTION_DAY } from '../../data/constants';

export interface GameClock {
  /** 1-based in-game day. */
  day: number;
  /** Minutes since midnight, 0..1439. */
  minutes: number;
}

/** 1 real minute = 1 in-game hour, so 1 real second = 1 in-game minute. */
export const GAME_MINUTES_PER_REAL_SECOND = 1;

export function createClock(): GameClock {
  return { day: 1, minutes: 6 * 60 };
}

export function advanceClock(clock: GameClock, realSeconds: number, speed: number): GameClock {
  if (realSeconds <= 0 || speed <= 0) return clock;
  const total = clock.minutes + realSeconds * GAME_MINUTES_PER_REAL_SECOND * speed;
  const extraDays = Math.floor(total / 1440);
  return { day: clock.day + extraDays, minutes: total - extraDays * 1440 };
}

export function skipToNextMorning(clock: GameClock): GameClock {
  return { day: clock.day + 1, minutes: 6 * 60 };
}

export function daysUntilElection(clock: GameClock, electionDay: number = ELECTION_DAY): number {
  return Math.max(0, electionDay - clock.day);
}

export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes % 60);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${suffix}`;
}

/** Daylight 0 (night) .. 1 (midday). */
export function daylightAt(minutes: number): number {
  const hour = minutes / 60;
  if (hour <= 5.5 || hour >= 18.5) return 0;
  return Math.min(1, Math.sin(((hour - 5.5) / 13) * Math.PI) * 1.4);
}
