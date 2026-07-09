import { WALL_E } from "@echowake/common";
import { describe, expect, it } from "vitest";
import {
  createSimulation,
  type ItemDef,
  type PlayerInput,
  type Simulation,
  type TickResult,
} from "../src/index.js";
import { addWall, makeOpenMaze } from "./helpers.js";
import { DEFS, collectAllFloorItems, findSeed, hasOneOfEach, idle, steerTo } from "./item-helpers.js";

/** Attacker in (1,1) facing +x (default), victim in (2,1): exactly fists range. */
const duelMaze = () =>
  makeOpenMaze(6, 6, {
    spawns: [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 4, y: 3 },
    ],
    exit: { x: 5, y: 5 },
  });

const duel = (opts?: { maze?: ReturnType<typeof makeOpenMaze>; items?: ItemDef[] }) => {
  const sim = createSimulation({ maze: opts?.maze ?? duelMaze(), seed: "duel", items: opts?.items ?? [] });
  sim.addPlayer();
  sim.addPlayer();
  return sim;
};

describe("melee attack", () => {
  it("hits the target in range and arc with fists by default", () => {
    const sim = duel();
    sim.act(0, { action: "attack" });
    const r = sim.step();
    expect(r.hits).toEqual([{ attacker: 0, target: 1, damage: 10 }]);
    expect(sim.getPlayerState(1).hp).toBe(90);
    const swing = r.sounds.find((s) => s.kind === "melee-swing");
    const hit = r.sounds.find((s) => s.kind === "melee-hit");
    expect(swing).toMatchObject({ x: 1.5, y: 1.5, emitterId: 0 });
    expect(hit).toMatchObject({ x: 2.5, y: 1.5, emitterId: 1 });
  });

  it("misses a target out of MELEE_RANGE (swing sound still emitted)", () => {
    const maze = makeOpenMaze(6, 6, {
      spawns: [
        { x: 1, y: 1 },
        { x: 3, y: 1 }, // 2 tiles away > MELEE_RANGE
      ],
      exit: { x: 5, y: 5 },
    });
    const sim = duel({ maze });
    sim.act(0, { action: "attack" });
    const r = sim.step();
    expect(r.hits).toEqual([]);
    expect(r.sounds.some((s) => s.kind === "melee-swing")).toBe(true);
    expect(r.sounds.some((s) => s.kind === "melee-hit")).toBe(false);
  });

  it("misses a target outside the swing arc; facing follows the last move direction", () => {
    const maze = makeOpenMaze(6, 6, {
      spawns: [
        { x: 1, y: 1 },
        { x: 0, y: 1 }, // due west of the attacker
      ],
      exit: { x: 5, y: 5 },
    });
    const sim = duel({ maze });
    // default facing is +x: the western target is behind the attacker
    sim.act(0, { action: "attack" });
    expect(sim.step().hits).toEqual([]);

    // turn west (facing updates from input before the attack applies), wait out
    // the cooldown, and swing again: now it connects
    sim.setInput(0, { moveX: -1, moveY: 0, sprint: false, sneak: false });
    for (let i = 0; i < 4; i++) sim.step(); // step closer without overrunning the target
    sim.setInput(0, idle);
    for (let i = 0; i < 8; i++) sim.step(); // cooldown (12 ticks for fists)
    sim.act(0, { action: "attack" });
    const r = sim.step();
    expect(r.hits).toEqual([{ attacker: 0, target: 1, damage: 10 }]);
  });

  it("cannot hit through a wall", () => {
    const maze = duelMaze();
    addWall(maze, 1, 1, WALL_E); // wall between attacker and victim
    const sim = duel({ maze });
    sim.act(0, { action: "attack" });
    const r = sim.step();
    expect(r.hits).toEqual([]);
    expect(r.sounds.some((s) => s.kind === "melee-swing")).toBe(true);
  });

  it("hits only the nearest target when several are in the arc", () => {
    const maze = makeOpenMaze(6, 6, {
      spawns: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 2, y: 1 }, // same cell as slot 1 (players do not collide)
      ],
      exit: { x: 5, y: 5 },
    });
    const sim = createSimulation({ maze, seed: "nearest", items: [] });
    sim.addPlayer();
    sim.addPlayer();
    sim.addPlayer();
    // slot 1 steps toward the attacker, becoming the nearest
    sim.setInput(1, { moveX: -1, moveY: 0, sprint: false, sneak: false });
    for (let i = 0; i < 3; i++) sim.step();
    sim.setInput(1, idle);

    sim.act(0, { action: "attack" });
    const r = sim.step();
    expect(r.hits).toEqual([{ attacker: 0, target: 1, damage: 10 }]);
    expect(sim.getPlayerState(1).hp).toBe(90);
    expect(sim.getPlayerState(2).hp).toBe(100);
  });

  it("enforces the per-player weapon cooldown, and at most one attack per tick", () => {
    const sim = duel();
    // double-queue before the first step: only one attack applies
    sim.act(0, { action: "attack" });
    sim.act(0, { action: "attack" });
    const first = sim.step();
    expect(first.hits.length).toBe(1);
    expect(first.sounds.filter((s) => s.kind === "melee-swing").length).toBe(1);

    // then spam every tick: fists cooldown is 0.6s = 12 ticks
    const hitTicks: number[] = [first.tick];
    for (let i = 0; i < 29; i++) {
      sim.act(0, { action: "attack" });
      const r = sim.step();
      for (const h of r.hits) hitTicks.push(r.tick);
    }
    expect(hitTicks).toEqual([1, 13, 25]);
    expect(sim.getPlayerState(1).hp).toBe(70);
  });
});

describe("damage pipeline (armor + auras)", () => {
  it("carried armor and a self-carried warding charm both reduce damage", () => {
    const maze = makeOpenMaze(16, 15, {
      spawns: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
      exit: { x: 15, y: 14 },
    });
    const sim = findSeed(
      (seed) => {
        const s = createSimulation({ maze, seed, items: [DEFS.ironArmor, DEFS.wardingCharm] });
        s.addPlayer();
        s.addPlayer();
        return s;
      },
      (s) => hasOneOfEach(s, [DEFS.ironArmor.id, DEFS.wardingCharm.id]),
    );
    collectAllFloorItems(sim, 1); // victim wears iron armor + carries a warding charm
    steerTo(sim, 1, 2.5, 1.5);

    sim.act(0, { action: "attack" });
    const r = sim.step();
    // fists 10 x armor 0.4 x warding 0.75
    expect(r.hits).toEqual([{ attacker: 0, target: 1, damage: 3 }]);
    expect(sim.getPlayerState(1).hp).toBe(97);
  });

  it("a warding aura applies by the TARGET's position, not the attacker's", () => {
    const maze = makeOpenMaze(8, 6, {
      spawns: [
        { x: 1, y: 1 }, // attacker at (1.5, 1.5)
        { x: 2, y: 1 }, // victim at (2.5, 1.5)
        { x: 4, y: 3 }, // bearer parks at (4.5, 3.5)
      ],
      exit: { x: 7, y: 5 },
    });
    const sim = createSimulation({ maze, seed: "ward-pos", items: [DEFS.wardingCharm] });
    sim.addPlayer();
    sim.addPlayer();
    sim.addPlayer();
    collectAllFloorItems(sim, 2);
    // bearer-victim distance ~2.83 (< 3), bearer-attacker ~3.6 (> 3): the aura
    // covers the TARGET only.
    steerTo(sim, 2, 4.5, 3.5);
    sim.act(0, { action: "attack" });
    expect(sim.step().hits).toEqual([{ attacker: 0, target: 1, damage: 7.5 }]);

    // move the bearer out of range of everyone: full damage again
    steerTo(sim, 2, 7.0, 5.0);
    sim.act(0, { action: "attack" });
    expect(sim.step().hits).toEqual([{ attacker: 0, target: 1, damage: 10 }]);
  });

  it("only the strongest single warding aura applies — auras do not stack", () => {
    const maze = makeOpenMaze(16, 15, {
      spawns: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
      exit: { x: 15, y: 14 },
    });
    const sim = findSeed(
      (seed) => {
        const s = createSimulation({
          maze,
          seed,
          items: [DEFS.wardingCharm, DEFS.strongWardingCharm],
        });
        s.addPlayer();
        s.addPlayer();
        return s;
      },
      (s) => hasOneOfEach(s, [DEFS.wardingCharm.id, DEFS.strongWardingCharm.id]),
    );
    collectAllFloorItems(sim, 1); // victim carries BOTH charms (0.75 and 0.5)
    steerTo(sim, 1, 2.5, 1.5);
    sim.act(0, { action: "attack" });
    // 10 x 0.5 (strongest only), NOT 10 x 0.5 x 0.75
    expect(sim.step().hits).toEqual([{ attacker: 0, target: 1, damage: 5 }]);
  });

  it("the best carried weapon is used", () => {
    const maze = makeOpenMaze(7, 7, {
      spawns: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
      exit: { x: 6, y: 6 },
    });
    const sim = createSimulation({ maze, seed: "weapon", items: [DEFS.sword] });
    sim.addPlayer();
    sim.addPlayer();
    collectAllFloorItems(sim, 0);
    steerTo(sim, 0, 1.5, 1.5);
    sim.setInput(0, { moveX: 1, moveY: 0, sprint: false, sneak: false });
    sim.step(); // face the victim again after wandering
    sim.setInput(0, idle);
    sim.act(0, { action: "attack" });
    const r = sim.step();
    expect(r.hits).toEqual([{ attacker: 0, target: 1, damage: 35 }]);
  });
});

describe("death", () => {
  it("drops the whole inventory, freezes the player, and reports the death once", () => {
    const maze = makeOpenMaze(7, 7, {
      spawns: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
      exit: { x: 6, y: 6 },
    });
    const sim = createSimulation({ maze, seed: "death", items: [DEFS.bandage] });
    sim.addPlayer();
    sim.addPlayer();
    collectAllFloorItems(sim, 1); // victim carries the only bandage
    steerTo(sim, 1, 2.5, 1.5);
    expect(sim.getPlayerState(1).inventory[0]).toBe(DEFS.bandage.id);

    const allDeaths: number[] = [];
    let hits = 0;
    for (let i = 0; i < 200 && allDeaths.length === 0; i++) {
      sim.act(0, { action: "attack" });
      const r = sim.step();
      hits += r.hits.length;
      allDeaths.push(...r.deaths);
    }
    expect(allDeaths).toEqual([1]);
    expect(hits).toBe(10); // 100 hp / 10 fists damage
    const victim = sim.getPlayerState(1);
    expect(victim.dead).toBe(true);
    expect(victim.hp).toBe(0);
    expect(victim.inventory).toEqual([null, null, null, null]);

    // inventory hit the floor at the death position
    const dropped = sim.listFloorItems();
    expect(dropped.map((f) => f.item)).toEqual([DEFS.bandage.id]);
    expect((dropped[0] as { x: number }).x).toBeCloseTo(victim.x, 10);
    expect((dropped[0] as { y: number }).y).toBeCloseTo(victim.y, 10);

    // dead players stop simulating: no movement, no sounds, no actions
    sim.setInput(1, { moveX: 1, moveY: 0, sprint: true, sneak: false });
    sim.act(1, { action: "attack" });
    const frozen = sim.step();
    expect(frozen.sounds.filter((s) => s.emitterId === 1)).toEqual([]);
    expect(frozen.deaths).toEqual([]); // reported exactly once
    expect(sim.getPlayerState(1).x).toBe(victim.x);
    expect(sim.getPlayerState(1).y).toBe(victim.y);

    // and cannot be hit again
    for (let i = 0; i < 13; i++) sim.step(); // cooldown
    sim.act(0, { action: "attack" });
    expect(sim.step().hits).toEqual([]);

    // the killer can loot the corpse
    steerTo(sim, 0, victim.x, victim.y);
    expect(sim.getPlayerState(0).inventory).toContain(DEFS.bandage.id);
    expect(sim.listFloorItems()).toEqual([]);
  });
});

describe("escaped players", () => {
  it("cannot attack or be attacked", () => {
    const maze = makeOpenMaze(5, 1, {
      spawns: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      exit: { x: 2, y: 0 },
    });
    const sim = createSimulation({ maze, seed: "escape", items: [] });
    sim.addPlayer();
    sim.addPlayer();
    // victim walks into the exit and escapes
    sim.setInput(1, { moveX: 1, moveY: 0, sprint: false, sneak: false });
    for (let i = 0; i < 15; i++) sim.step();
    expect(sim.getPlayerState(1).escaped).toBe(true);

    // attacker walks right next to the (escaped) victim and swings
    steerTo(sim, 0, 1.6, 0.5);
    sim.act(0, { action: "attack" });
    const r = sim.step();
    expect(r.sounds.some((s) => s.kind === "melee-swing")).toBe(true);
    expect(r.hits).toEqual([]);

    // and the escaped player cannot swing at all
    for (let i = 0; i < 13; i++) sim.step();
    sim.act(1, { action: "attack" });
    const r2 = sim.step();
    expect(r2.sounds.some((s) => s.kind === "melee-swing")).toBe(false);
    expect(r2.hits).toEqual([]);
  });
});

describe("determinism with items and interleaved actions", () => {
  const scriptedInput = (slot: number, tick: number): PlayerInput => {
    const phase = ((tick + slot * 37) >> 4) % 4;
    const moveX = phase === 0 ? 1 : phase === 2 ? -1 : 0;
    const moveY = phase === 1 ? 1 : phase === 3 ? -1 : 0;
    return {
      moveX: moveX + (phase === 1 ? 1 : 0),
      moveY,
      sprint: tick % 3 === 0,
      sneak: tick % 7 === 0,
    };
  };

  const runSim = (sim: Simulation, slots: number[], ticks: number): TickResult[] => {
    const log: TickResult[] = [];
    for (let t = 0; t < ticks; t++) {
      for (const slot of slots) {
        sim.setInput(slot, scriptedInput(slot, t));
        if (t % 5 === slot) sim.act(slot, { action: "attack" });
        if (t % 17 === 0) sim.act(slot, { action: "use", slot: (t + slot) % 4 });
        if (t % 23 === 0) sim.act(slot, { action: "drop", slot: (t + slot) % 4 });
      }
      log.push(sim.step());
    }
    return log;
  };

  it("two sims with identical inputs and actions are identical after 200 ticks", () => {
    const build = () => {
      const maze = makeOpenMaze(16, 15, {
        spawns: [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
          { x: 1, y: 2 },
        ],
        exit: { x: 15, y: 14 },
      });
      addWall(maze, 3, 3, WALL_E);
      addWall(maze, 3, 4, WALL_E);
      addWall(maze, 5, 5, WALL_E);
      return maze;
    };
    const items: ItemDef[] = [
      DEFS.sword,
      DEFS.ironArmor,
      DEFS.softBoots,
      DEFS.wardingCharm,
      DEFS.veilCharm,
      DEFS.bandage,
      DEFS.noisemaker,
    ];
    const simA = createSimulation({ maze: build(), seed: "items-match", items });
    const simB = createSimulation({ maze: build(), seed: "items-match", items });
    const slotsA = [simA.addPlayer(), simA.addPlayer(), simA.addPlayer()];
    const slotsB = [simB.addPlayer(), simB.addPlayer(), simB.addPlayer()];
    expect(slotsA).toEqual(slotsB);
    expect(simA.listFloorItems()).toEqual(simB.listFloorItems());

    const logA = runSim(simA, slotsA, 200);
    const logB = runSim(simB, slotsB, 200);

    expect(simA.tick).toBe(200);
    expect(JSON.stringify(logA)).toBe(JSON.stringify(logB)); // sounds, hits, deaths, pickups, ...
    // the scenario actually exercised combat
    expect(logA.flatMap((r) => r.hits).length).toBeGreaterThan(0);
    for (const slot of slotsA) {
      const a = simA.getPlayerState(slot);
      const b = simB.getPlayerState(slot);
      expect(a.x).toBe(b.x); // bit-exact, not approximate
      expect(a.y).toBe(b.y);
      expect(a.hp).toBe(b.hp);
      expect(a.facingX).toBe(b.facingX);
      expect(a.facingY).toBe(b.facingY);
      expect(a.dead).toBe(b.dead);
      expect(a.escaped).toBe(b.escaped);
      expect(a.inventory).toEqual(b.inventory);
    }
    expect(simA.listFloorItems()).toEqual(simB.listFloorItems());
  });
});
