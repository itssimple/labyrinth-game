import type { ItemDef, PlayerInput, Simulation, TickResult } from "../src/index.js";

/**
 * Hand-crafted item defs for ecs tests. Deliberately NOT imported from
 * @echowake/content — the injection boundary is the point of the design, so
 * the ecs test suite owns its own small definitions.
 */
export const DEFS = {
  sword: {
    id: "test-sword",
    name: "Test Sword",
    kind: "weapon",
    damage: 35,
    cooldownS: 0.8,
  } as ItemDef,
  ironArmor: {
    id: "test-iron",
    name: "Test Iron Armor",
    kind: "armor",
    damageTakenMul: 0.4,
    footstepMul: 1.4,
  } as ItemDef,
  loudArmor: {
    id: "test-loud-armor",
    name: "Test Loud Armor",
    kind: "armor",
    damageTakenMul: 0.9,
    footstepMul: 1.5,
  } as ItemDef,
  clangingArmor: {
    id: "test-clanging-armor",
    name: "Test Clanging Armor",
    kind: "armor",
    damageTakenMul: 0.9,
    footstepMul: 4,
  } as ItemDef,
  softBoots: {
    id: "test-boots",
    name: "Test Boots",
    kind: "boots",
    footstepMul: 0.5,
  } as ItemDef,
  wardingCharm: {
    id: "test-warding",
    name: "Test Warding Charm",
    kind: "charm",
    aura: { radius: 3, damageTakenMul: 0.75 },
  } as ItemDef,
  strongWardingCharm: {
    id: "test-strong-warding",
    name: "Test Strong Warding Charm",
    kind: "charm",
    aura: { radius: 3, damageTakenMul: 0.5 },
  } as ItemDef,
  cursedCharm: {
    id: "test-cursed",
    name: "Test Cursed Charm",
    kind: "charm",
    aura: { radius: 3, damageTakenMul: 1.5 },
  } as ItemDef,
  veilCharm: {
    id: "test-veil",
    name: "Test Veil Charm",
    kind: "charm",
    aura: { radius: 2, emittedSoundMul: 0.5 },
  } as ItemDef,
  bandage: {
    id: "test-bandage",
    name: "Test Bandage",
    kind: "consumable",
    healHp: 30,
  } as ItemDef,
  noisemaker: {
    id: "test-noisemaker",
    name: "Test Noisemaker",
    kind: "consumable",
    noisemaker: { durationS: 1, intervalS: 0.25 },
  } as ItemDef,
} as const;

export const idle: PlayerInput = { moveX: 0, moveY: 0, sprint: false, sneak: false };

/**
 * Walk `slot` to (tx, ty) in an open maze by naive per-axis steering,
 * stepping the whole simulation. Returns every TickResult produced on the
 * way. Ends within ~0.08 tiles per axis of the target.
 */
export function steerTo(
  sim: Simulation,
  slot: number,
  tx: number,
  ty: number,
  maxTicks = 5000,
): TickResult[] {
  const results: TickResult[] = [];
  for (let i = 0; i < maxTicks; i++) {
    const s = sim.getPlayerState(slot);
    const dx = tx - s.x;
    const dy = ty - s.y;
    const mx = Math.abs(dx) < 0.08 ? 0 : Math.sign(dx);
    const my = Math.abs(dy) < 0.08 ? 0 : Math.sign(dy);
    if (mx === 0 && my === 0) {
      sim.setInput(slot, idle);
      return results;
    }
    sim.setInput(slot, { moveX: mx, moveY: my, sprint: false, sneak: false });
    results.push(sim.step());
  }
  throw new Error(`steerTo: slot ${slot} did not reach (${tx}, ${ty}) in ${maxTicks} ticks`);
}

/**
 * Deterministically search seeds "probe-0", "probe-1", ... until `ok(sim)`
 * accepts one. Used to find seeds whose floor-item spawn matches a scenario
 * (e.g. exactly one of each def) — deterministic forever for a given maze,
 * defs and predicate.
 */
export function findSeed(
  make: (seed: string) => Simulation,
  ok: (sim: Simulation) => boolean,
  max = 300,
): Simulation {
  for (let i = 0; i < max; i++) {
    const sim = make(`probe-${i}`);
    if (ok(sim)) return sim;
  }
  throw new Error("findSeed: no seed matched the scenario predicate");
}

/** Predicate: floor holds exactly one item of each given def id. */
export function hasOneOfEach(sim: Simulation, ids: string[]): boolean {
  const items = sim.listFloorItems().map((f) => f.item);
  return items.length === ids.length && ids.every((id) => items.filter((i) => i === id).length === 1);
}

/** Steer `slot` over every floor item until it has picked them all up. */
export function collectAllFloorItems(sim: Simulation, slot: number): void {
  for (;;) {
    const items = sim.listFloorItems();
    if (items.length === 0) return;
    const first = items[0] as { x: number; y: number };
    steerTo(sim, slot, first.x, first.y);
    if (sim.listFloorItems().length >= items.length) {
      throw new Error("collectAllFloorItems: pickup did not happen");
    }
  }
}
