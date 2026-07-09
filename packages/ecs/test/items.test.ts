import { INVENTORY_SLOTS, SOUND_INTENSITY, cellIndex } from "@echowake/common";
import { describe, expect, it } from "vitest";
import { createSimulation, type ItemDef, type Simulation, type TickResult } from "../src/index.js";
import { makeOpenMaze } from "./helpers.js";
import { DEFS, collectAllFloorItems, findSeed, hasOneOfEach, idle, steerTo } from "./item-helpers.js";

const ALL_DEFS: ItemDef[] = Object.values(DEFS);

describe("floor item spawning", () => {
  const makeMaze = () =>
    makeOpenMaze(20, 20, {
      spawns: [
        { x: 0, y: 0 },
        { x: 19, y: 19 },
        { x: 10, y: 10 },
      ],
      exit: { x: 5, y: 5 },
    });

  it("spawns ~cells/CELLS_PER_ITEM items, same seed => identical items", () => {
    const a = createSimulation({ maze: makeMaze(), seed: "spawn-seed", items: ALL_DEFS });
    const b = createSimulation({ maze: makeMaze(), seed: "spawn-seed", items: ALL_DEFS });
    expect(a.listFloorItems().length).toBe(3); // round(400 / 120)
    expect(a.listFloorItems()).toEqual(b.listFloorItems());
  });

  it("itemSeed decouples item placement from the public maze seed", () => {
    const base = createSimulation({ maze: makeMaze(), seed: "spawn-seed", items: ALL_DEFS });
    const salted = createSimulation({
      maze: makeMaze(),
      seed: "spawn-seed",
      items: ALL_DEFS,
      itemSeed: "secret-salt",
    });
    const saltedOtherPublic = createSimulation({
      maze: makeMaze(),
      seed: "other-public-seed",
      items: ALL_DEFS,
      itemSeed: "secret-salt",
    });
    // same seed, different itemSeed => different placements (a client knowing
    // only the broadcast maze seed cannot derive where the loot is)
    expect(salted.listFloorItems()).not.toEqual(base.listFloorItems());
    // same itemSeed => identical placements, whatever the public seed says
    expect(salted.listFloorItems()).toEqual(saltedOtherPublic.listFloorItems());
  });

  it("never spawns on spawn or exit cells, and spreads items out", () => {
    for (let i = 0; i < 10; i++) {
      const maze = makeMaze();
      const sim = createSimulation({ maze, seed: `spawn-${i}`, items: ALL_DEFS });
      const forbidden = new Set([
        ...maze.spawns.map((s) => cellIndex(maze.width, s.x, s.y)),
        cellIndex(maze.width, maze.exit.x, maze.exit.y),
      ]);
      const items = sim.listFloorItems();
      const cells = items.map((f) => cellIndex(maze.width, Math.floor(f.x), Math.floor(f.y)));
      for (const c of cells) expect(forbidden.has(c)).toBe(false);
      expect(new Set(cells).size).toBe(items.length); // all on distinct cells
      // spread out: minimum pairwise distance stays well above adjacency
      for (let m = 0; m < items.length; m++) {
        for (let n = m + 1; n < items.length; n++) {
          const a = items[m] as { x: number; y: number };
          const b = items[n] as { x: number; y: number };
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          expect(d).toBeGreaterThan(2);
        }
      }
    }
  });

  it("picks defs by spawnWeight (weight 0 never spawns)", () => {
    const defs: ItemDef[] = [
      { ...DEFS.bandage, spawnWeight: 0 },
      { ...DEFS.sword, spawnWeight: 2 },
    ];
    for (let i = 0; i < 5; i++) {
      const sim = createSimulation({ maze: makeMaze(), seed: `weight-${i}`, items: defs });
      for (const f of sim.listFloorItems()) expect(f.item).toBe(DEFS.sword.id);
    }
  });

  it("omitting the items option means no items and no combat behavior", () => {
    const maze = makeOpenMaze(5, 5, { spawns: [{ x: 1, y: 1 }], exit: { x: 4, y: 4 } });
    const sim = createSimulation({ maze, seed: "legacy" });
    sim.addPlayer();
    expect(sim.listFloorItems()).toEqual([]);
    sim.act(0, { action: "attack" });
    const r = sim.step();
    expect(r.sounds).toEqual([]);
    expect(r.hits).toEqual([]);
    // legacy PlayerState shape is preserved exactly
    expect(sim.getPlayerState(0)).toEqual({ x: 1.5, y: 1.5, escaped: false });
  });
});

describe("pickup / use / drop lifecycle", () => {
  it("auto-picks a floor item into the first free slot, with sound and TickResult entry", () => {
    const maze = makeOpenMaze(5, 5, { spawns: [{ x: 0, y: 0 }], exit: { x: 4, y: 4 } });
    const sim = createSimulation({ maze, seed: "pickup", items: [DEFS.bandage] });
    sim.addPlayer();
    const item = sim.listFloorItems()[0];
    expect(item).toBeDefined();
    const results = steerTo(sim, 0, (item as { x: number }).x, (item as { y: number }).y);
    const pickTick = results.find((r) => r.pickups.length > 0);
    expect(pickTick?.pickups).toEqual([{ slot: 0, item: DEFS.bandage.id }]);
    expect(pickTick?.sounds.some((s) => s.kind === "pickup" && s.emitterId === 0)).toBe(true);
    expect(sim.getPlayerState(0).inventory).toEqual([DEFS.bandage.id, null, null, null]);
    expect(sim.listFloorItems()).toEqual([]);
  });

  it("drop puts the item on the floor; the dropper re-picks only after walking away", () => {
    const maze = makeOpenMaze(7, 7, { spawns: [{ x: 1, y: 1 }], exit: { x: 6, y: 6 } });
    const sim = createSimulation({ maze, seed: "drop", items: [DEFS.bandage] });
    sim.addPlayer();
    const item = sim.listFloorItems()[0] as { x: number; y: number };
    steerTo(sim, 0, item.x, item.y);
    expect(sim.getPlayerState(0).inventory[0]).toBe(DEFS.bandage.id);

    sim.act(0, { action: "drop", slot: 0 });
    sim.step();
    const me = sim.getPlayerState(0);
    expect(sim.getPlayerState(0).inventory).toEqual([null, null, null, null]);
    const dropped = sim.listFloorItems();
    expect(dropped.length).toBe(1);
    expect((dropped[0] as { x: number }).x).toBeCloseTo(me.x, 10);
    expect((dropped[0] as { y: number }).y).toBeCloseTo(me.y, 10);

    // standing on it does NOT bounce it back into the inventory
    for (let i = 0; i < 10; i++) {
      expect(sim.step().pickups).toEqual([]);
    }
    expect(sim.listFloorItems().length).toBe(1);

    // walk away, come back: now it picks up again
    steerTo(sim, 0, me.x + 1.5, me.y);
    steerTo(sim, 0, me.x, me.y);
    expect(sim.getPlayerState(0).inventory[0]).toBe(DEFS.bandage.id);
    expect(sim.listFloorItems()).toEqual([]);
  });

  it("use(bandage) heals clamped to MAX_HP and consumes it", () => {
    const maze = makeOpenMaze(7, 7, {
      spawns: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
      exit: { x: 6, y: 6 },
    });
    const sim = createSimulation({ maze, seed: "heal", items: [DEFS.bandage] });
    sim.addPlayer(); // attacker
    sim.addPlayer(); // victim
    const item = sim.listFloorItems()[0] as { x: number; y: number };
    steerTo(sim, 1, item.x, item.y);
    steerTo(sim, 1, 2.5, 1.5); // back into fists range of the attacker

    sim.act(0, { action: "attack" });
    const hitResult = sim.step();
    expect(hitResult.hits.length).toBe(1);
    expect(sim.getPlayerState(1).hp).toBe(90);

    sim.act(1, { action: "use", slot: 0 });
    sim.step();
    expect(sim.getPlayerState(1).hp).toBe(100); // 90 + 30 clamped to MAX_HP
    expect(sim.getPlayerState(1).inventory).toEqual([null, null, null, null]);
  });

  it("use on a non-consumable is a no-op", () => {
    const maze = makeOpenMaze(5, 5, { spawns: [{ x: 0, y: 0 }], exit: { x: 4, y: 4 } });
    const sim = createSimulation({ maze, seed: "use-weapon", items: [DEFS.sword] });
    sim.addPlayer();
    const item = sim.listFloorItems()[0] as { x: number; y: number };
    steerTo(sim, 0, item.x, item.y);
    sim.act(0, { action: "use", slot: 0 });
    sim.step();
    expect(sim.getPlayerState(0).inventory[0]).toBe(DEFS.sword.id);
    expect(sim.getPlayerState(0).hp).toBe(100);
  });

  it("with all inventory slots full, floor items stay on the floor", () => {
    const maze = makeOpenMaze(25, 24, { spawns: [{ x: 0, y: 0 }], exit: { x: 24, y: 23 } });
    const sim = createSimulation({ maze, seed: "full-inv", items: [DEFS.bandage] });
    sim.addPlayer();
    expect(sim.listFloorItems().length).toBe(5); // round(600 / 120)

    // grab the first INVENTORY_SLOTS items
    while (sim.getPlayerState(0).inventory.includes(null)) {
      const next = sim.listFloorItems()[0] as { x: number; y: number };
      steerTo(sim, 0, next.x, next.y);
    }
    expect(sim.getPlayerState(0).inventory).toEqual(
      new Array(INVENTORY_SLOTS).fill(DEFS.bandage.id),
    );
    const leftover = sim.listFloorItems();
    expect(leftover.length).toBe(1);
    const results = steerTo(sim, 0, (leftover[0] as { x: number }).x, (leftover[0] as { y: number }).y);
    expect(results.flatMap((r) => r.pickups)).toEqual([]);
    expect(sim.listFloorItems().length).toBe(1);
  });
});

describe("noisemaker", () => {
  it("emits deceptive footstep-walk sounds on schedule at its position, then stops", () => {
    const maze = makeOpenMaze(5, 5, { spawns: [{ x: 0, y: 0 }], exit: { x: 4, y: 4 } });
    // durationS 1, intervalS 0.25 => 4 emissions, 5 ticks apart
    const sim = createSimulation({ maze, seed: "noise", items: [DEFS.noisemaker] });
    sim.addPlayer();
    const item = sim.listFloorItems()[0] as { x: number; y: number };
    steerTo(sim, 0, item.x, item.y);
    const pos = sim.getPlayerState(0);

    sim.act(0, { action: "use", slot: 0 });
    const useTick = sim.tick + 1; // applied during the next step
    const emitted: { tick: number; x: number; y: number; intensity: number; emitterId: number }[] =
      [];
    for (let i = 0; i < 40; i++) {
      for (const s of sim.step().sounds) {
        if (s.kind === "footstep-walk" && s.emitterId >= 16) emitted.push(s);
      }
    }
    expect(sim.getPlayerState(0).inventory).toEqual([null, null, null, null]); // consumed
    expect(emitted.map((e) => e.tick - useTick)).toEqual([5, 10, 15, 20]);
    for (const e of emitted) {
      expect(e.x).toBe(pos.x);
      expect(e.y).toBe(pos.y);
      expect(e.intensity).toBe(SOUND_INTENSITY["footstep-walk"]);
    }
  });

  it("noisemaker emissions honor the veil aura by ORIGIN, not by who placed it", () => {
    const maze = makeOpenMaze(16, 15, { spawns: [{ x: 1, y: 7 }], exit: { x: 15, y: 14 } });
    const longNoise: ItemDef = {
      ...DEFS.noisemaker,
      noisemaker: { durationS: 3, intervalS: 0.5 },
    };
    const sim = findSeed(
      (seed) => createSimulation({ maze, seed, items: [DEFS.veilCharm, longNoise] }),
      (s) => hasOneOfEach(s, [DEFS.veilCharm.id, longNoise.id]),
    );
    sim.addPlayer();
    collectAllFloorItems(sim, 0); // carries the veil charm AND the noisemaker

    const invSlot = sim.getPlayerState(0).inventory.indexOf(longNoise.id);
    sim.act(0, { action: "use", slot: invSlot });
    sim.step(); // noisemaker placed at the player's position, veil bearer on top of it
    const origin = sim.getPlayerState(0);

    const emitted: { intensity: number }[] = [];
    const collect = (rs: TickResult[]) => {
      for (const r of rs) {
        for (const s of r.sounds) {
          if (s.kind === "footstep-walk" && s.emitterId >= 16) emitted.push(s);
        }
      }
    };
    // stay put for the first emission (bearer within radius of the origin)
    const idleSteps: TickResult[] = [];
    for (let i = 0; i < 12; i++) idleSteps.push(sim.step());
    collect(idleSteps);
    expect(emitted.length).toBe(1);
    expect(emitted[0]?.intensity).toBeCloseTo(0.4 * 0.5, 10);

    // walk the veil bearer far away: later emissions are full volume again
    const tx = origin.x > 8 ? origin.x - 5 : origin.x + 5;
    collect(steerTo(sim, 0, tx, origin.y));
    sim.setInput(0, idle);
    const tail: TickResult[] = [];
    for (let i = 0; i < 40; i++) tail.push(sim.step());
    collect(tail);
    expect(emitted.length).toBe(6); // durationS 3 / intervalS 0.5
    const last = emitted[emitted.length - 1];
    expect(last?.intensity).toBe(SOUND_INTENSITY["footstep-walk"]);
  });
});

describe("footstep multipliers and veil aura", () => {
  it("carried footstep multipliers stack multiplicatively", () => {
    const maze = makeOpenMaze(16, 15, { spawns: [{ x: 1, y: 7 }], exit: { x: 15, y: 14 } });
    const sim = findSeed(
      (seed) => createSimulation({ maze, seed, items: [DEFS.loudArmor, DEFS.softBoots] }),
      (s) => hasOneOfEach(s, [DEFS.loudArmor.id, DEFS.softBoots.id]),
    );
    sim.addPlayer();
    collectAllFloorItems(sim, 0);
    steerTo(sim, 0, 1.5, 7.5); // a known clear runway start

    const sounds: { kind: string; intensity: number }[] = [];
    sim.setInput(0, { moveX: 1, moveY: 0, sprint: false, sneak: false });
    for (let i = 0; i < 14; i++) sounds.push(...sim.step().sounds);
    const steps = sounds.filter((s) => s.kind === "footstep-walk");
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) expect(s.intensity).toBeCloseTo(0.4 * 1.5 * 0.5, 10);
  });

  it("clamps final sound intensity to 1", () => {
    const maze = makeOpenMaze(7, 7, { spawns: [{ x: 1, y: 1 }], exit: { x: 6, y: 6 } });
    const sim = createSimulation({ maze, seed: "clamp", items: [DEFS.clangingArmor] });
    sim.addPlayer();
    const item = sim.listFloorItems()[0] as { x: number; y: number };
    steerTo(sim, 0, item.x, item.y);
    steerTo(sim, 0, 1.5, 1.5);

    const sounds: { kind: string; intensity: number }[] = [];
    sim.setInput(0, { moveX: 1, moveY: 0, sprint: true, sneak: false });
    for (let i = 0; i < 20; i++) sounds.push(...sim.step().sounds);
    const steps = sounds.filter((s) => s.kind === "footstep-sprint");
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) expect(s.intensity).toBe(1); // 0.8 * 4 clamped
  });

  it("veil dampens sounds emitted inside its radius only", () => {
    const maze = makeOpenMaze(6, 6, {
      spawns: [
        { x: 2, y: 2 }, // bearer
        { x: 1, y: 2 }, // walker
      ],
      exit: { x: 5, y: 0 },
    });
    const sim = createSimulation({ maze, seed: "veil", items: [DEFS.veilCharm] }); // radius 2
    sim.addPlayer();
    sim.addPlayer();
    const item = sim.listFloorItems()[0] as { x: number; y: number };
    steerTo(sim, 0, item.x, item.y); // bearer grabs the charm
    steerTo(sim, 0, 2.5, 2.5); // and parks at its post

    const walk = (ticks: number) => {
      const out: { kind: string; intensity: number; emitterId: number }[] = [];
      sim.setInput(1, { moveX: 1, moveY: 0, sprint: false, sneak: false });
      for (let i = 0; i < ticks; i++) out.push(...sim.step().sounds);
      sim.setInput(1, idle);
      return out.filter((s) => s.kind === "footstep-walk" && s.emitterId === 1);
    };

    // near pass: walker moves from (1.5, 2.5) toward +x, staying within 2 tiles
    const near = walk(14);
    expect(near.length).toBeGreaterThan(0);
    for (const s of near) expect(s.intensity).toBeCloseTo(0.4 * 0.5, 10);

    // far pass: same walk along y = 5.0, always > 2 tiles from the bearer
    steerTo(sim, 1, 1.5, 5.0);
    const far = walk(14);
    expect(far.length).toBeGreaterThan(0);
    for (const s of far) expect(s.intensity).toBeCloseTo(0.4, 10);
  });
});
