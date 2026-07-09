import { describe, expect, it } from "vitest";
import { MATCH_DURATION_S_PER_SIZE, TICK_RATE, cellIndex } from "@labyrinth/common";
import { computeVisibleCells, createSimulation, type Simulation } from "@labyrinth/ecs";
import { generateMaze } from "@labyrinth/mazegen";
import { createBotController, type BotObservation } from "../src/index.js";

/** Build the observation a server would feed this bot before sim.step(). */
function observe(sim: Simulation, slot: number): BotObservation {
  const state = sim.getPlayerState(slot);
  return {
    tick: sim.tick,
    x: state.x,
    y: state.y,
    escaped: state.escaped,
    visibleCells: computeVisibleCells(sim.maze, state.x, state.y),
    sounds: [],
  };
}

function expectValidInput(input: { moveX: number; moveY: number; sprint: boolean; sneak: boolean }): void {
  expect([-1, 0, 1]).toContain(input.moveX);
  expect([-1, 0, 1]).toContain(input.moveY);
  expect(input.sprint).toBe(false);
  expect(input.sneak).toBe(false);
}

describe("createBotController", () => {
  it("is deterministic: same seed + observations => identical inputs over 150 ticks", () => {
    const seed = "determinism-seed";
    const maze = generateMaze({ seed, size: "tiny" });
    const sim = createSimulation({ maze, seed });
    const slot = sim.addPlayer();
    const a = createBotController({ maze, seed, slot });
    const b = createBotController({ maze, seed, slot });

    for (let t = 0; t < 150; t++) {
      const obs = observe(sim, slot);
      const inputA = a.next(obs);
      const inputB = b.next(obs);
      expect(inputB).toEqual(inputA);
      expectValidInput(inputA);
      sim.setInput(slot, inputA);
      sim.step();
    }
  });

  it("explores a real tiny maze and escapes well within the match budget", () => {
    // Fixed seed chosen with margin: this bot escapes at tick 1034, far under
    // the budget of 4x the tiny match timer (4 * 180s * 20 = 14400 ticks).
    const seed = "charlie";
    const maze = generateMaze({ seed, size: "tiny" });
    const budget = 4 * MATCH_DURATION_S_PER_SIZE.tiny * TICK_RATE;

    const sim = createSimulation({ maze, seed });
    const slot = sim.addPlayer();
    const bot = createBotController({ maze, seed: `${seed}:match`, slot });

    let escapedAt = -1;
    for (let t = 0; t < budget && escapedAt === -1; t++) {
      const input = bot.next(observe(sim, slot));
      expectValidInput(input);
      sim.setInput(slot, input);
      const result = sim.step();
      if (result.escapes.includes(slot)) escapedAt = result.tick;
    }

    expect(escapedAt).toBeGreaterThan(0);
    expect(escapedAt).toBeLessThan(budget / 2); // generous margin against flakiness
    expect(sim.getPlayerState(slot).escaped).toBe(true);
  });

  it("idles once escaped and never emits out-of-contract values", () => {
    const seed = "charlie";
    const maze = generateMaze({ seed, size: "tiny" });
    const sim = createSimulation({ maze, seed });
    const slot = sim.addPlayer();
    const bot = createBotController({ maze, seed, slot });

    // Fake an escaped observation: the bot must stand still.
    const idle = bot.next({
      tick: 1,
      x: maze.exit.x + 0.5,
      y: maze.exit.y + 0.5,
      escaped: true,
      visibleCells: new Set<number>(),
      sounds: [],
    });
    expect(idle).toEqual({ moveX: 0, moveY: 0, sprint: false, sneak: false });
  });

  it("heads for the exit once the exit cell has been seen", () => {
    const seed = "exit-beeline";
    const maze = generateMaze({ seed, size: "tiny" });
    const sim = createSimulation({ maze, seed });
    const slot = sim.addPlayer();
    const bot = createBotController({ maze, seed, slot });
    const exitIdx = cellIndex(maze.width, maze.exit.x, maze.exit.y);
    const budget = 4 * MATCH_DURATION_S_PER_SIZE.tiny * TICK_RATE;

    let exitSeenAt = -1;
    let escapedAt = -1;
    for (let t = 0; t < budget && escapedAt === -1; t++) {
      const obs = observe(sim, slot);
      if (exitSeenAt === -1 && obs.visibleCells.has(exitIdx)) exitSeenAt = obs.tick;
      sim.setInput(slot, bot.next(obs));
      const result = sim.step();
      if (result.escapes.includes(slot)) escapedAt = result.tick;
    }

    expect(exitSeenAt).toBeGreaterThanOrEqual(0);
    expect(escapedAt).toBeGreaterThan(exitSeenAt);
    // Once seen, the bot commits: it should cover the remaining distance at
    // walk speed without wandering off to explore. VISION_RADIUS is 8, so
    // seeing the exit means a path of at most a few dozen cells remains —
    // allow ample slack for maze detours while still catching regressions
    // where the bot ignores a seen exit.
    expect(escapedAt - exitSeenAt).toBeLessThan(30 * TICK_RATE);
  });
});
