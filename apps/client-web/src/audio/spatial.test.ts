import { describe, expect, it } from "vitest";
import { MOVE_SPEED, TICK_RATE } from "@echowake/common";
import {
  confidenceLowpassHz,
  FOOTSTEP_INTERVAL_S,
  FootstepCadence,
  footstepIntervalTiles,
  perceivedGain,
  stereoPan,
  type MoveMode,
} from "./spatial";

describe("stereoPan", () => {
  it("is centered for a sound on top of the listener", () => {
    expect(stereoPan(0, 0)).toBe(0);
  });

  it("pans fully right/left for distant lateral sounds", () => {
    expect(stereoPan(10, 0)).toBe(1);
    expect(stereoPan(-10, 0)).toBe(-1);
  });

  it("keeps sounds straight ahead/behind centered regardless of distance", () => {
    expect(stereoPan(0, -6)).toBe(0);
    expect(stereoPan(0, 6)).toBe(0);
  });

  it("pans nearby sounds less than far sounds in the same direction", () => {
    const near = stereoPan(0.5, 0);
    const far = stereoPan(8, 0);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(far);
  });

  it("stays within [-1, 1] for diagonal offsets", () => {
    for (const [dx, dy] of [
      [3, 4],
      [-7, 2],
      [100, -100],
      [0.1, 0.1],
    ] as const) {
      const pan = stereoPan(dx, dy);
      expect(pan).toBeGreaterThanOrEqual(-1);
      expect(pan).toBeLessThanOrEqual(1);
      expect(Math.sign(pan)).toBe(Math.sign(dx));
    }
  });
});

describe("perceivedGain", () => {
  it("maps the intensity range endpoints exactly", () => {
    expect(perceivedGain(0)).toBe(0);
    expect(perceivedGain(1)).toBe(1);
  });

  it("clamps out-of-range intensities", () => {
    expect(perceivedGain(-0.5)).toBe(0);
    expect(perceivedGain(2)).toBe(1);
  });

  it("is monotonic and boosts quiet sounds (sqrt curve)", () => {
    expect(perceivedGain(0.25)).toBeCloseTo(0.5, 10);
    expect(perceivedGain(0.2)).toBeLessThan(perceivedGain(0.4));
    expect(perceivedGain(0.1)).toBeGreaterThan(0.1);
  });
});

describe("confidenceLowpassHz", () => {
  it("muffles only low-confidence sounds", () => {
    expect(confidenceLowpassHz("low")).not.toBeNull();
    expect(confidenceLowpassHz("medium")).toBeNull();
    expect(confidenceLowpassHz("high")).toBeNull();
  });
});

describe("footstep cadence", () => {
  it("mirrors the ecs tuning intervals (packages/ecs/src/tuning.ts)", () => {
    // If these change in the simulation, what you hear of yourself would
    // desync from what other players see/hear — keep them identical.
    expect(FOOTSTEP_INTERVAL_S).toEqual({ sneak: 0.7, walk: 0.45, sprint: 0.3 });
    for (const mode of ["sneak", "walk", "sprint"] as const) {
      expect(footstepIntervalTiles(mode)).toBeCloseTo(MOVE_SPEED[mode] * FOOTSTEP_INTERVAL_S[mode], 10);
    }
  });

  it.each(["sneak", "walk", "sprint"] as const)(
    "fires one step per FOOTSTEP_INTERVAL_S seconds of continuous %s movement",
    (mode: MoveMode) => {
      const cadence = new FootstepCadence();
      const perTick = MOVE_SPEED[mode] / TICK_RATE; // tiles per snapshot
      const seconds = 10;
      let steps = 0;
      for (let i = 0; i < seconds * TICK_RATE; i++) steps += cadence.advance(perTick, mode);
      expect(steps).toBe(Math.floor(seconds / FOOTSTEP_INTERVAL_S[mode]));
    },
  );

  it("accumulates across partial deltas", () => {
    const cadence = new FootstepCadence();
    const interval = footstepIntervalTiles("walk");
    expect(cadence.advance(interval * 0.6, "walk")).toBe(0);
    expect(cadence.advance(interval * 0.6, "walk")).toBe(1);
  });

  it("ignores zero, negative and NaN deltas", () => {
    const cadence = new FootstepCadence();
    expect(cadence.advance(0, "walk")).toBe(0);
    expect(cadence.advance(-1, "walk")).toBe(0);
    expect(cadence.advance(Number.NaN, "walk")).toBe(0);
  });

  it("treats a giant delta as a teleport: no burst of steps, accumulator reset", () => {
    const cadence = new FootstepCadence();
    const interval = footstepIntervalTiles("walk");
    cadence.advance(interval * 0.9, "walk"); // almost due
    expect(cadence.advance(25, "walk")).toBe(0); // spawn jump / refocus
    // The pre-teleport progress must be gone too.
    expect(cadence.advance(interval * 0.5, "walk")).toBe(0);
  });

  it("resets on demand (new match)", () => {
    const cadence = new FootstepCadence();
    const interval = footstepIntervalTiles("sprint");
    cadence.advance(interval * 0.9, "sprint");
    cadence.reset();
    expect(cadence.advance(interval * 0.5, "sprint")).toBe(0);
  });
});
