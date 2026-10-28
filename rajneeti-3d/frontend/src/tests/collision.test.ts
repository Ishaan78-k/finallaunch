import { describe, expect, it } from 'vitest';
import { resolveCircle } from '../game/engine/collision';

const box = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };

describe('circle vs box collision', () => {
  it('leaves a free circle alone', () => {
    expect(resolveCircle(5, 0, 0.5, box)).toEqual({ x: 5, z: 0 });
  });
  it('pushes an overlapping circle out of the box', () => {
    const r = resolveCircle(2.2, 0, 0.5, box);
    expect(r.x).toBeCloseTo(2.5);
    expect(r.z).toBeCloseTo(0);
  });
  it('ejects a circle whose centre is inside', () => {
    const r = resolveCircle(1.9, 0, 0.5, box);
    expect(r.x).toBeGreaterThanOrEqual(2.5 - 1e-9);
  });
});
