export interface Collider { minX: number; maxX: number; minZ: number; maxZ: number }

/** Pushes a circle out of an axis-aligned box. Pure function so it can be unit tested without WebGL. */
export function resolveCircle(px: number, pz: number, r: number, c: Collider): { x: number; z: number } {
  const cx = Math.min(Math.max(px, c.minX), c.maxX);
  const cz = Math.min(Math.max(pz, c.minZ), c.maxZ);
  const dx = px - cx;
  const dz = pz - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return { x: px, z: pz };
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    const k = (r - d) / d;
    return { x: px + dx * k, z: pz + dz * k };
  }
  // Centre is inside the box: leave through the nearest side.
  const left = px - c.minX, right = c.maxX - px, up = c.maxZ - pz, down = pz - c.minZ;
  const m = Math.min(left, right, up, down);
  if (m === left) return { x: c.minX - r, z: pz };
  if (m === right) return { x: c.maxX + r, z: pz };
  if (m === up) return { x: px, z: c.maxZ + r };
  return { x: px, z: c.minZ - r };
}
