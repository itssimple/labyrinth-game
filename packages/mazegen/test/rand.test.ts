import { describe, expect, it } from "vitest";
import { createRng, hashString } from "../src/rand.js";

// TODO(integration): these cover the private fallback; keep them (or move to
// @echowake/math) when src/rand.ts switches over.
describe("rand fallback", () => {
  it("same seed yields identical sequences", () => {
    const a = createRng("seed");
    const b = createRng("seed");
    for (let i = 0; i < 100; i++) expect(b.next()).toBe(a.next());
  });

  it("different seeds diverge", () => {
    const a = createRng("seed-a");
    const b = createRng("seed-b");
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqB).not.toEqual(seqA);
  });

  it("next stays in [0, 1) and int in [min, max)", () => {
    const rng = createRng("bounds");
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const n = rng.int(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThan(7);
    }
  });

  it("pick throws on empty; shuffle preserves elements and leaves input untouched", () => {
    const rng = createRng("pick");
    expect(() => rng.pick([])).toThrow();
    const input = [1, 2, 3, 4, 5];
    const out = rng.shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect([...out].sort((a, b) => a - b)).toEqual(input);
  });

  it("hashString is stable and 32-bit unsigned", () => {
    expect(hashString("labyrinth")).toBe(hashString("labyrinth"));
    expect(hashString("a")).not.toBe(hashString("b"));
    const h = hashString("labyrinth:carve");
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
  });
});
