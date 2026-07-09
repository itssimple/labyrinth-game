import { WALL_E, type RawSoundEvent } from "@echowake/common";
import { describe, expect, it } from "vitest";
import { perceiveSound } from "../src/index.js";
import { addWall, makeOpenMaze } from "./helpers.js";

const sprintStep = (x: number, y: number, tick = 1, emitterId = 0): RawSoundEvent => ({
  kind: "footstep-sprint",
  x,
  y,
  intensity: 0.8,
  emitterId,
  tick,
});

describe("perceiveSound", () => {
  it("same cell: full intensity, high confidence, exact position", () => {
    const maze = makeOpenMaze(5, 5);
    const p = perceiveSound(maze, "m", sprintStep(2.5, 2.5), 2.2, 2.7);
    expect(p).not.toBeNull();
    expect(p?.confidence).toBe("high");
    expect(p?.intensity).toBeCloseTo(0.8, 10);
    expect(p?.x).toBe(2.5);
    expect(p?.y).toBe(2.5);
    expect(p?.tick).toBe(1);
    expect(p?.kind).toBe("footstep-sprint");
  });

  it("intensity falls off with BFS path distance", () => {
    const maze = makeOpenMaze(20, 1);
    const near = perceiveSound(maze, "m", sprintStep(0.5, 0.5), 4.5, 0.5); // 4 tiles
    const far = perceiveSound(maze, "m", sprintStep(0.5, 0.5), 8.5, 0.5); // 8 tiles
    expect(near?.intensity).toBeCloseTo(0.8 - 4 * 0.05, 10);
    expect(far?.intensity).toBeCloseTo(0.8 - 8 * 0.05, 10);
    expect(near?.confidence).toBe("high"); // 0.6 boundary is high
    expect(far?.confidence).toBe("medium");
  });

  it("a wall attenuates far more than the same open distance", () => {
    const walled = makeOpenMaze(2, 1);
    addWall(walled, 0, 0, WALL_E);
    const open = makeOpenMaze(2, 1);
    const sound = sprintStep(0.5, 0.5);
    const throughWall = perceiveSound(walled, "m", sound, 1.5, 0.5);
    const throughOpen = perceiveSound(open, "m", sound, 1.5, 0.5);
    expect(throughOpen?.intensity).toBeCloseTo(0.75, 10);
    // Stone wall: 0.8 - 0.05 (distance) - 0.5 (wall) = 0.25
    expect(throughWall?.intensity).toBeCloseTo(0.25, 10);
    expect(throughWall!.intensity).toBeLessThan(throughOpen!.intensity);
    expect(throughWall?.confidence).toBe("medium");
  });

  it("prefers a longer open path over a costlier through-wall shortcut", () => {
    // 3x3, wall directly between source (0,0) and listener (1,0); the sound
    // routes around through row 1 (3 open steps = 0.15) instead of through
    // the Stone wall (1 step + 0.5 = 0.55).
    const maze = makeOpenMaze(3, 3);
    addWall(maze, 0, 0, WALL_E);
    const p = perceiveSound(maze, "m", sprintStep(0.5, 0.5), 1.5, 0.5);
    expect(p?.intensity).toBeCloseTo(0.8 - 3 * 0.05, 10);
  });

  it("quiet sounds behind walls are inaudible (null)", () => {
    const maze = makeOpenMaze(2, 1);
    addWall(maze, 0, 0, WALL_E);
    const sneak: RawSoundEvent = {
      kind: "footstep-sneak",
      x: 0.5,
      y: 0.5,
      intensity: 0.15,
      emitterId: 0,
      tick: 1,
    };
    expect(perceiveSound(maze, "m", sneak, 1.5, 0.5)).toBeNull();
  });

  it("dies out entirely with distance", () => {
    const maze = makeOpenMaze(20, 1);
    // 15 tiles: 0.8 - 0.75 = 0.05 <= threshold → null
    expect(perceiveSound(maze, "m", sprintStep(0.5, 0.5), 15.5, 0.5)).toBeNull();
    // 14 tiles: 0.10 → low
    const low = perceiveSound(maze, "m", sprintStep(0.5, 0.5), 14.5, 0.5);
    expect(low?.confidence).toBe("low");
  });

  it("medium/low positions are jittered within their band radius", () => {
    const maze = makeOpenMaze(20, 3);
    const medium = perceiveSound(maze, "m", sprintStep(9.5, 1.5), 3.5, 1.5); // 6 tiles → 0.5
    expect(medium?.confidence).toBe("medium");
    expect(Math.abs((medium?.x ?? 0) - 9.5)).toBeLessThanOrEqual(1.5 + 1e-9);
    expect(Math.abs((medium?.y ?? 0) - 1.5)).toBeLessThanOrEqual(1.5 + 1e-9);

    const low = perceiveSound(maze, "m", sprintStep(13.5, 1.5), 0.5, 1.5); // 13 tiles → 0.15
    expect(low?.confidence).toBe("low");
    expect(Math.abs((low?.x ?? 0) - 13.5)).toBeLessThanOrEqual(4 + 1e-9);
    // clamped to the maze, never outside
    expect(low!.y).toBeGreaterThanOrEqual(0);
    expect(low!.y).toBeLessThanOrEqual(3);
  });

  it("jitter is deterministic per (matchSeed, tick, emitterId) and shared by listeners", () => {
    const maze = makeOpenMaze(20, 3);
    const sound = sprintStep(9.5, 1.5, 42, 3);
    const a = perceiveSound(maze, "seed-A", sound, 3.5, 1.5);
    const b = perceiveSound(maze, "seed-A", sound, 3.5, 1.5);
    expect(a).toEqual(b); // identical call → identical result

    // Same band, different listener → same perceived origin (no triangulation cheats)
    const otherListener = perceiveSound(maze, "seed-A", sound, 15.5, 1.5);
    expect(otherListener?.confidence).toBe("medium");
    expect(otherListener?.x).toBe(a?.x);
    expect(otherListener?.y).toBe(a?.y);

    // Changing any seed ingredient changes the jitter
    const otherTick = perceiveSound(maze, "seed-A", sprintStep(9.5, 1.5, 43, 3), 3.5, 1.5);
    const otherEmitter = perceiveSound(maze, "seed-A", sprintStep(9.5, 1.5, 42, 4), 3.5, 1.5);
    const otherSeed = perceiveSound(maze, "seed-B", sound, 3.5, 1.5);
    expect([otherTick?.x, otherTick?.y]).not.toEqual([a?.x, a?.y]);
    expect([otherEmitter?.x, otherEmitter?.y]).not.toEqual([a?.x, a?.y]);
    expect([otherSeed?.x, otherSeed?.y]).not.toEqual([a?.x, a?.y]);
  });
});
