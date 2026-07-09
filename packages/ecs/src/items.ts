import { CELLS_PER_ITEM, cellIndex, type Maze } from "@echowake/common";
import { createRng, distSq } from "@echowake/math";

/**
 * Structural mirror of @echowake/content's ItemDef. The ecs must NEVER import
 * @echowake/content (moddability boundary — definitions are injected into
 * createSimulation), so the shape is redeclared here; content's defs satisfy
 * it structurally. Keep in sync with docs/CONTRACTS.md "Items, combat & auras".
 */
export interface ItemDef {
  id: string;
  name: string;
  kind: "weapon" | "armor" | "boots" | "charm" | "consumable";
  damage?: number;
  cooldownS?: number;
  damageTakenMul?: number;
  footstepMul?: number;
  aura?: { radius: number; damageTakenMul?: number; emittedSoundMul?: number };
  healHp?: number;
  noisemaker?: { durationS: number; intervalS: number };
  spawnWeight?: number;
}

/**
 * Implicit default weapon used when a player carries no weapon. Mirrors
 * @echowake/content's FISTS (which is deliberately not part of ITEM_DEFS and
 * therefore never injected) — the ecs cannot import content, so the stats are
 * duplicated here. Keep in sync with packages/content.
 */
export const DEFAULT_FISTS: ItemDef = {
  id: "fists",
  name: "Fists",
  kind: "weapon",
  damage: 10,
  cooldownS: 0.6,
};

/** A planned floor item spawn (cell-center position, def id). */
export interface PlannedItemSpawn {
  item: string;
  x: number;
  y: number;
}

/**
 * Deterministically plan floor item spawns for a maze: about
 * `cells / CELLS_PER_ITEM` items (at least 1 when any def can spawn), def
 * chosen by spawnWeight, never on spawn or exit cells, spread out via a
 * greedy minimum-spacing pass over a seeded shuffle (spacing relaxes if the
 * maze is too small to satisfy it). All randomness comes from
 * `createRng(`${seed}:items`)` — same seed, same items, forever.
 */
export function planItemSpawns(
  maze: Maze,
  defs: readonly ItemDef[],
  seed: string,
): PlannedItemSpawn[] {
  const weights = defs.map((d) => Math.max(0, d.spawnWeight ?? 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (defs.length === 0 || totalWeight <= 0) return [];

  const cells = maze.width * maze.height;
  const count = Math.max(1, Math.round(cells / CELLS_PER_ITEM));
  const rng = createRng(`${seed}:items`);

  // Candidate cells: everything except spawns and the exit.
  const excluded = new Set<number>(
    maze.spawns.map((s) => cellIndex(maze.width, s.x, s.y)),
  );
  excluded.add(cellIndex(maze.width, maze.exit.x, maze.exit.y));
  const candidates: number[] = [];
  for (let i = 0; i < cells; i++) {
    if (!excluded.has(i)) candidates.push(i);
  }
  if (candidates.length === 0) return [];

  const pool = rng.shuffle(candidates);
  const picked: number[] = [];
  const pickedSet = new Set<number>();
  // Ideal grid spacing is sqrt(cells/count); start at half that (squared)
  // and relax when the maze cannot fit `count` items at the current spacing.
  let spacing2 = (cells / count) * 0.25;
  for (;;) {
    for (const idx of pool) {
      if (picked.length >= count) break;
      if (pickedSet.has(idx)) continue;
      const x = (idx % maze.width) + 0.5;
      const y = Math.floor(idx / maze.width) + 0.5;
      let ok = true;
      for (const p of picked) {
        const px = (p % maze.width) + 0.5;
        const py = Math.floor(p / maze.width) + 0.5;
        if (distSq(x, y, px, py) < spacing2) {
          ok = false;
          break;
        }
      }
      if (ok) {
        picked.push(idx);
        pickedSet.add(idx);
      }
    }
    if (picked.length >= count || spacing2 <= 0.5) break;
    spacing2 /= 4;
  }

  // Weighted def choice per placed item (one rng draw each — deterministic).
  return picked.map((idx) => {
    let roll = rng.next() * totalWeight;
    let chosen = defs.length - 1;
    for (let i = 0; i < defs.length; i++) {
      roll -= weights[i] ?? 0;
      if (roll < 0) {
        chosen = i;
        break;
      }
    }
    const def = defs[chosen] as ItemDef;
    return {
      item: def.id,
      x: (idx % maze.width) + 0.5,
      y: Math.floor(idx / maze.width) + 0.5,
    };
  });
}

/**
 * Product of `footstepMul` / `damageTakenMul` over every carried item —
 * multipliers from carried items stack multiplicatively (README). Charm auras
 * are handled separately (strongest single aura only).
 */
export function inventoryMul(
  inventory: readonly (string | null)[],
  defs: ReadonlyMap<string, ItemDef>,
  key: "footstepMul" | "damageTakenMul",
): number {
  let mul = 1;
  for (const id of inventory) {
    if (id === null) continue;
    const v = defs.get(id)?.[key];
    if (v !== undefined) mul *= v;
  }
  return mul;
}

/** Best carried weapon (highest damage, first slot wins ties), else FISTS. */
export function bestWeapon(
  inventory: readonly (string | null)[],
  defs: ReadonlyMap<string, ItemDef>,
): ItemDef {
  let best = DEFAULT_FISTS;
  for (const id of inventory) {
    if (id === null) continue;
    const def = defs.get(id);
    if (def?.kind === "weapon" && (def.damage ?? 0) > (best.damage ?? 0)) {
      best = def;
    }
  }
  return best;
}
