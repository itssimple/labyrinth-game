import { describe, expect, it } from "vitest";
import { createRng, hashString } from "../src/index.js";

describe("hashString", () => {
  it("is deterministic and matches FNV-1a known answers", () => {
    // FNV-1a 32-bit reference values.
    expect(hashString("")).toBe(2166136261); // offset basis 0x811c9dc5
    expect(hashString("a")).toBe(3826002220); // 0xe40c292c
    expect(hashString("labyrinth")).toBe(19088168);
    expect(hashString("seed:maze")).toBe(3260289725);
  });

  it("returns an unsigned 32-bit integer", () => {
    for (const s of ["", "a", "labyrinth", "☃ unicode ☃", "x".repeat(1000)]) {
      const h = hashString(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("distinguishes sub-seed purposes", () => {
    expect(hashString("seed:walls")).not.toBe(hashString("seed:spawns"));
  });
});

describe("createRng", () => {
  it("same seed produces the same sequence", () => {
    const a = createRng("determinism");
    const b = createRng("determinism");
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it("different seeds produce different sequences", () => {
    const a = createRng("seed-one");
    const b = createRng("seed-two");
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("known-answer regression: seed 'labyrinth' first values are pinned forever", () => {
    // If this test fails, generated worlds change for every existing seed.
    // Never update these numbers to make a refactor pass.
    const rng = createRng("labyrinth");
    expect(Array.from({ length: 8 }, () => rng.next())).toEqual([
      0.4897097968496382, 0.20093192625790834, 0.8546408719848841,
      0.41078738775104284, 0.7816347025800496, 0.024238059064373374,
      0.7572423764504492, 0.7602848277892917,
    ]);
    // Continues the same stream: int() consumes next().
    expect(Array.from({ length: 5 }, () => rng.int(0, 100))).toEqual([
      98, 35, 14, 37, 29,
    ]);
  });

  it("known-answer regression: shuffle and pick sequences are pinned", () => {
    const s = createRng("shuffle-seed");
    expect(s.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([
      4, 0, 8, 9, 1, 3, 2, 5, 7, 6,
    ]);
    const p = createRng("pick-seed");
    expect(
      Array.from({ length: 5 }, () => p.pick(["a", "b", "c", "d"] as const)),
    ).toEqual(["d", "c", "a", "a", "a"]);
  });

  it("next() stays in [0, 1)", () => {
    const rng = createRng("range");
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("int(min, max) stays in [min, max) and hits every value", () => {
    const rng = createRng("int-range");
    const seen = new Set<number>();
    for (let i = 0; i < 5_000; i++) {
      const v = rng.int(-3, 4);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(4);
      seen.add(v);
    }
    expect(seen.size).toBe(7);
  });

  it("pick throws on an empty array", () => {
    const rng = createRng("pick");
    expect(() => rng.pick([])).toThrow();
  });

  it("pick only returns elements of the array", () => {
    const rng = createRng("pick-members");
    const items = ["x", "y", "z"] as const;
    for (let i = 0; i < 1_000; i++) {
      expect(items).toContain(rng.pick(items));
    }
  });

  it("shuffle returns a permutation and leaves the input untouched", () => {
    const rng = createRng("shuffle");
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const frozen = [...input];
    const out = rng.shuffle(input);
    expect(input).toEqual(frozen);
    expect(out).not.toBe(input);
    expect([...out].sort((a, b) => a - b)).toEqual(frozen);
  });

  it("shuffle of an empty or single-element array works", () => {
    const rng = createRng("shuffle-edge");
    expect(rng.shuffle([])).toEqual([]);
    expect(rng.shuffle([42])).toEqual([42]);
  });
});
