import { MOVE_SPEED, PLAYER_RADIUS, SOUND_INTENSITY, TICK_DT, WALL_E } from "@labyrinth/common";
import { describe, expect, it } from "vitest";
import { createSimulation, type PlayerInput, type Simulation } from "../src/index.js";
import { addWall, makeOpenMaze } from "./helpers.js";

const input = (moveX: number, moveY: number, sprint = false, sneak = false): PlayerInput => ({
  moveX,
  moveY,
  sprint,
  sneak,
});

describe("createSimulation", () => {
  it("adds players at their spawn slots and reports state", () => {
    const maze = makeOpenMaze(5, 5, {
      spawns: [
        { x: 1, y: 1 },
        { x: 3, y: 3 },
      ],
      exit: { x: 4, y: 4 },
    });
    const sim = createSimulation({ maze, seed: "s" });
    expect(sim.addPlayer()).toBe(0);
    expect(sim.addPlayer()).toBe(1);
    expect(sim.getPlayerState(0)).toEqual({ x: 1.5, y: 1.5, escaped: false });
    expect(sim.getPlayerState(1)).toEqual({ x: 3.5, y: 3.5, escaped: false });
    expect(() => sim.addPlayer()).toThrow(); // only 2 spawns
    expect(sim.tick).toBe(0);
  });

  it("reuses freed slots and rejects stale slot access", () => {
    const maze = makeOpenMaze(5, 5, {
      spawns: [
        { x: 1, y: 1 },
        { x: 3, y: 3 },
      ],
    });
    const sim = createSimulation({ maze, seed: "s" });
    sim.addPlayer();
    sim.addPlayer();
    sim.removePlayer(0);
    expect(() => sim.getPlayerState(0)).toThrow();
    expect(sim.addPlayer()).toBe(0);
    expect(sim.getPlayerState(0)).toEqual({ x: 1.5, y: 1.5, escaped: false });
  });

  it("moves at MOVE_SPEED and normalizes diagonal input", () => {
    const maze = makeOpenMaze(9, 9, { spawns: [{ x: 1, y: 1 }], exit: { x: 8, y: 8 } });
    const straight = createSimulation({ maze, seed: "s" });
    straight.addPlayer();
    straight.setInput(0, input(1, 0));
    const diagonal = createSimulation({ maze, seed: "s" });
    diagonal.addPlayer();
    diagonal.setInput(0, input(1, 1));
    for (let i = 0; i < 10; i++) {
      straight.step();
      diagonal.step();
    }
    const s = straight.getPlayerState(0);
    const d = diagonal.getPlayerState(0);
    const expected = MOVE_SPEED.walk * TICK_DT * 10;
    expect(s.x - 1.5).toBeCloseTo(expected, 10);
    expect(s.y).toBeCloseTo(1.5, 10);
    const diagDist = Math.sqrt((d.x - 1.5) ** 2 + (d.y - 1.5) ** 2);
    expect(diagDist).toBeCloseTo(expected, 10);
  });

  it("never crosses a wall", () => {
    const maze = makeOpenMaze(3, 3, { spawns: [{ x: 1, y: 1 }], exit: { x: 0, y: 0 } });
    addWall(maze, 1, 1, WALL_E); // wall at x = 2
    const sim = createSimulation({ maze, seed: "s" });
    sim.addPlayer();
    sim.setInput(0, input(1, 0, true)); // sprint straight into the wall
    for (let i = 0; i < 100; i++) sim.step();
    const s = sim.getPlayerState(0);
    expect(s.x).toBeLessThanOrEqual(2 - PLAYER_RADIUS + 1e-9);
    expect(s.x).toBeGreaterThan(1.5); // did approach the wall
    expect(s.y).toBeCloseTo(1.5, 9);
  });

  it("slides along a wall instead of sticking", () => {
    const maze = makeOpenMaze(3, 3, { spawns: [{ x: 1, y: 1 }], exit: { x: 0, y: 0 } });
    // full-height wall between columns 1 and 2
    addWall(maze, 1, 0, WALL_E);
    addWall(maze, 1, 1, WALL_E);
    addWall(maze, 1, 2, WALL_E);
    const sim = createSimulation({ maze, seed: "s" });
    sim.addPlayer();
    sim.setInput(0, input(1, 1)); // push diagonally into the wall
    for (let i = 0; i < 40; i++) sim.step();
    const s = sim.getPlayerState(0);
    expect(s.x).toBeLessThanOrEqual(2 - PLAYER_RADIUS + 1e-9);
    expect(s.y).toBeGreaterThan(2); // slid south along the wall
    expect(s.y).toBeLessThanOrEqual(3 - PLAYER_RADIUS + 1e-9); // border wall holds
  });

  it("stays inside the maze borders", () => {
    const maze = makeOpenMaze(3, 3, { spawns: [{ x: 0, y: 0 }], exit: { x: 2, y: 2 } });
    const sim = createSimulation({ maze, seed: "s" });
    sim.addPlayer();
    sim.setInput(0, input(-1, -1, true));
    for (let i = 0; i < 50; i++) sim.step();
    const s = sim.getPlayerState(0);
    expect(s.x).toBeGreaterThanOrEqual(PLAYER_RADIUS - 1e-9);
    expect(s.y).toBeGreaterThanOrEqual(PLAYER_RADIUS - 1e-9);
  });

  it("emits footsteps by distance moved, with mode-specific kind and cadence", () => {
    const maze = makeOpenMaze(30, 1, { spawns: [{ x: 0, y: 0 }], exit: { x: 29, y: 0 } });

    const run = (moveInput: PlayerInput, ticks: number) => {
      const sim = createSimulation({ maze, seed: "s" });
      sim.addPlayer();
      sim.setInput(0, moveInput);
      const emitted: { tick: number; kind: string; intensity: number; emitterId: number }[] = [];
      for (let i = 0; i < ticks; i++) {
        for (const snd of sim.step().sounds) emitted.push(snd);
      }
      return emitted;
    };

    // walk: 0.15 tiles/tick, interval 3.0 * 0.45 = 1.35 tiles → ~every 9 ticks
    // (exact ticks follow IEEE-754 accumulation, which is itself deterministic)
    const walk = run(input(1, 0), 20);
    expect(walk.length).toBe(2);
    expect(walk[0]).toMatchObject({
      tick: 10,
      kind: "footstep-walk",
      intensity: SOUND_INTENSITY["footstep-walk"],
      emitterId: 0,
    });
    expect(walk[1]?.tick).toBe(19);

    // sprint: 0.25 tiles/tick, interval 5.0 * 0.3 = 1.5 tiles → every 6 ticks
    const sprint = run(input(1, 0, true), 20);
    expect(sprint.map((s) => s.tick)).toEqual([6, 12, 18]);
    expect(sprint[0]?.kind).toBe("footstep-sprint");

    // sneak: 0.075 tiles/tick, interval 1.5 * 0.7 = 1.05 tiles → ~every 14 ticks
    const sneak = run(input(1, 0, false, true), 20);
    expect(sneak.map((s) => s.tick)).toEqual([15]);
    expect(sneak[0]?.kind).toBe("footstep-sneak");

    // stationary players are silent
    expect(run(input(0, 0), 20).length).toBe(0);
  });

  it("escape triggers once and escaped players stop simulating", () => {
    const maze = makeOpenMaze(5, 1, { spawns: [{ x: 0, y: 0 }], exit: { x: 2, y: 0 } });
    const sim = createSimulation({ maze, seed: "s" });
    sim.addPlayer();
    sim.setInput(0, input(1, 0));
    const allEscapes: number[][] = [];
    for (let i = 0; i < 15; i++) allEscapes.push(sim.step().escapes);
    // 1.5 tiles to the exit-cell boundary at 0.15/tick → escapes around tick 10
    const escapeTick = allEscapes.findIndex((e) => e.length > 0) + 1;
    expect(escapeTick).toBeGreaterThanOrEqual(10);
    expect(escapeTick).toBeLessThanOrEqual(11);
    expect(allEscapes.flat()).toEqual([0]); // exactly once
    const atEscape = sim.getPlayerState(0);
    expect(atEscape.escaped).toBe(true);
    // further input moves nothing and emits nothing
    sim.setInput(0, input(1, 0, true));
    for (let i = 0; i < 10; i++) {
      const r = sim.step();
      expect(r.sounds.length).toBe(0);
      expect(r.escapes.length).toBe(0);
    }
    expect(sim.getPlayerState(0).x).toBe(atEscape.x);
    expect(sim.getPlayerState(0).y).toBe(atEscape.y);
  });
});

describe("determinism", () => {
  const scriptedInput = (slot: number, tick: number): PlayerInput => {
    // Deterministic pseudo-pattern: circle-ish movement that differs per slot.
    const phase = ((tick + slot * 37) >> 4) % 4;
    const moveX = phase === 0 ? 1 : phase === 2 ? -1 : 0;
    const moveY = phase === 1 ? 1 : phase === 3 ? -1 : 0;
    return {
      moveX: moveX + (phase === 1 ? 1 : 0), // some diagonals too
      moveY,
      sprint: tick % 3 === 0,
      sneak: tick % 7 === 0,
    };
  };

  const runSim = (sim: Simulation, slots: number[], ticks: number) => {
    const log: unknown[] = [];
    for (let t = 0; t < ticks; t++) {
      for (const slot of slots) sim.setInput(slot, scriptedInput(slot, t));
      log.push(sim.step());
    }
    return log;
  };

  it("two sims with identical inputs are identical after 200 ticks", () => {
    const build = () => {
      const maze = makeOpenMaze(9, 9, {
        spawns: [
          { x: 1, y: 1 },
          { x: 7, y: 7 },
          { x: 1, y: 7 },
        ],
        exit: { x: 4, y: 0 },
      });
      addWall(maze, 3, 3, WALL_E);
      addWall(maze, 3, 4, WALL_E);
      addWall(maze, 5, 5, WALL_E);
      return maze;
    };
    const simA = createSimulation({ maze: build(), seed: "match-1" });
    const simB = createSimulation({ maze: build(), seed: "match-1" });
    const slotsA = [simA.addPlayer(), simA.addPlayer(), simA.addPlayer()];
    const slotsB = [simB.addPlayer(), simB.addPlayer(), simB.addPlayer()];
    expect(slotsA).toEqual(slotsB);

    const logA = runSim(simA, slotsA, 200);
    const logB = runSim(simB, slotsB, 200);

    expect(simA.tick).toBe(200);
    expect(JSON.stringify(logA)).toBe(JSON.stringify(logB)); // every tick, sound, escape
    for (const slot of slotsA) {
      const a = simA.getPlayerState(slot);
      const b = simB.getPlayerState(slot);
      expect(a.x).toBe(b.x); // bit-exact, not approximate
      expect(a.y).toBe(b.y);
      expect(a.escaped).toBe(b.escaped);
    }
  });
});
