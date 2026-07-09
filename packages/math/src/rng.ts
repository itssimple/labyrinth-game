import { hashString } from "./hash.js";

/** Deterministic pseudo-random number generator (see docs/CONTRACTS.md). */
export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [min, max) — max exclusive. */
  int(min: number, max: number): number;
  /** Uniform pick. Throws on empty array. */
  pick<T>(items: readonly T[]): T;
  /** Fisher–Yates shuffle; returns a new array, input untouched. */
  shuffle<T>(items: readonly T[]): T[];
}

/**
 * mulberry32 core: given a 32-bit state, returns a function producing
 * floats in [0, 1). Fast, deterministic, good enough statistical quality
 * for gameplay content generation.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create a seeded {@link Rng}: mulberry32 initialized with
 * `hashString(seed)`. Same seed string => identical sequence, forever.
 *
 * @param seed - Any string; distinct strings give (practically) independent
 *   streams. Sub-seed with `createRng(`${seed}:${purpose}`)`.
 */
export function createRng(seed: string): Rng {
  const next = mulberry32(hashString(seed));

  const int = (min: number, max: number): number =>
    Math.floor(next() * (max - min)) + min;

  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new Error("Rng.pick: cannot pick from an empty array");
      }
      return items[int(0, items.length)] as T;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i + 1);
        const tmp = out[i] as T;
        out[i] = out[j] as T;
        out[j] = tmp;
      }
      return out;
    },
  };
}
