/** Deterministic seeded RNG (mulberry32). Same seed always gives the same sequence. */
export class Rng {
  private a: number;
  constructor(seed: number) { this.a = seed | 0; }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }
  pick<T>(items: readonly T[]): T { return items[Math.floor(this.next() * items.length)]; }
  /** Roughly bell-shaped integer in [min, max]. */
  bell(min: number, max: number): number {
    const t = (this.next() + this.next() + this.next()) / 3;
    return Math.round(min + t * (max - min)) + 0; // + 0 turns -0 into 0
  }
  weighted<T>(items: readonly { item: T; weight: number }[]): T {
    const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
    let r = this.next() * total;
    for (const i of items) { r -= Math.max(0, i.weight); if (r <= 0) return i.item; }
    return items[items.length - 1].item;
  }
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
