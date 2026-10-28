import { describe, expect, it } from 'vitest';
import { advanceClock, createClock, daylightAt, daysUntilElection, formatTime, skipToNextMorning } from '../simulation/calendar/clock';

describe('game clock', () => {
  it('advances one in-game hour per real minute', () => {
    const c = advanceClock({ day: 1, minutes: 0 }, 60, 1);
    expect(c.minutes).toBeCloseTo(60);
    expect(c.day).toBe(1);
  });
  it('rolls over to the next day', () => {
    const c = advanceClock({ day: 1, minutes: 1430 }, 20, 1);
    expect(c.day).toBe(2);
    expect(c.minutes).toBeCloseTo(10);
  });
  it('fast-forward keeps day and minutes consistent', () => {
    const c = advanceClock(createClock(), 24 * 60 * 3, 1); // three full days
    expect(c.day).toBe(4);
    expect(c.minutes).toBeCloseTo(6 * 60);
  });
  it('ignores zero or negative time', () => {
    const c = createClock();
    expect(advanceClock(c, 0, 1)).toBe(c);
    expect(advanceClock(c, 5, 0)).toBe(c);
  });
  it('counts down to election day and never goes negative', () => {
    expect(daysUntilElection({ day: 1, minutes: 0 })).toBe(180);
    expect(daysUntilElection({ day: 181, minutes: 0 })).toBe(0);
    expect(daysUntilElection({ day: 500, minutes: 0 })).toBe(0);
  });
  it('skipping a day lands on the next morning', () => {
    expect(skipToNextMorning({ day: 5, minutes: 900 })).toEqual({ day: 6, minutes: 360 });
  });
  it('formats time and daylight', () => {
    expect(formatTime(0)).toBe('12:00 AM');
    expect(formatTime(13 * 60 + 5)).toBe('1:05 PM');
    expect(daylightAt(0)).toBe(0);
    expect(daylightAt(12 * 60)).toBeGreaterThan(0.9);
  });
});
