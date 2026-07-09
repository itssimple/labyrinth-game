/**
 * Item definitions — the v1 set from README "Items & Equipment".
 *
 * These are pure data: the simulation (@echowake/ecs) receives them through
 * `createSimulation({ items })` and never imports this package, so mods can
 * swap the whole set. Every def is validated at module load; a malformed def
 * throws immediately (bad mods must fail loudly, not corrupt matches).
 */

export type ItemKind = "weapon" | "armor" | "boots" | "charm" | "consumable";

export interface ItemDef {
  /** Stable identifier, kebab-case (e.g. "rusty-sword"). */
  id: string;
  /** Display name. */
  name: string;
  kind: ItemKind;
  // weapon
  /** Hp removed per connected hit. */
  damage?: number;
  /** Seconds between swings. */
  cooldownS?: number;
  /** Damage taken multiplier while carried (<1 protects). */
  damageTakenMul?: number;
  /** Footstep intensity multiplier while carried (>1 is louder). */
  footstepMul?: number;
  /** Charm aura: radius in tiles; applies to EVERYONE within range, bearer included. */
  aura?: { radius: number; damageTakenMul?: number; emittedSoundMul?: number };
  /** Consumable: hp restored on use (clamped to MAX_HP). */
  healHp?: number;
  /** Consumable: fake footstep-walk emitter placed on use. */
  noisemaker?: { durationS: number; intervalS: number };
  /** How often this item appears relative to others (default 1; 0 = never spawns). */
  spawnWeight?: number;
}

const KINDS: readonly ItemKind[] = ["weapon", "armor", "boots", "charm", "consumable"];

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Multipliers outside this range are considered nonsense (modding guardrail). */
const MUL_MIN = 0;
const MUL_MAX = 10;

function fail(def: { id?: unknown }, message: string): never {
  const id = typeof def.id === "string" && def.id.length > 0 ? def.id : "<no id>";
  throw new Error(`@echowake/content: invalid item def "${id}": ${message}`);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function checkMul(def: ItemDef, field: string, v: number | undefined): void {
  if (v === undefined) return;
  if (!isFiniteNumber(v) || v < MUL_MIN || v > MUL_MAX) {
    fail(def, `${field} must be a finite number in [${MUL_MIN}, ${MUL_MAX}], got ${String(v)}`);
  }
}

function checkPositive(def: ItemDef, field: string, v: unknown, max: number): asserts v is number {
  if (!isFiniteNumber(v) || v <= 0 || v > max) {
    fail(def, `${field} must be a finite number in (0, ${max}], got ${String(v)}`);
  }
}

/**
 * Validate one item definition; throws a descriptive Error on any malformed
 * field (unknown kind, out-of-range multipliers, missing per-kind fields).
 * Exported so mod loaders can validate custom defs the same way.
 */
export function validateItemDef(def: ItemDef): void {
  if (typeof def !== "object" || def === null) {
    throw new Error("@echowake/content: item def must be an object");
  }
  if (typeof def.id !== "string" || !ID_PATTERN.test(def.id)) {
    fail(def, `id must be a non-empty kebab-case string, got ${JSON.stringify(def.id)}`);
  }
  if (typeof def.name !== "string" || def.name.length === 0) {
    fail(def, "name must be a non-empty string");
  }
  if (!KINDS.includes(def.kind)) {
    fail(def, `unknown kind ${JSON.stringify(def.kind)}`);
  }

  checkMul(def, "damageTakenMul", def.damageTakenMul);
  checkMul(def, "footstepMul", def.footstepMul);
  if (def.spawnWeight !== undefined) {
    if (!isFiniteNumber(def.spawnWeight) || def.spawnWeight < 0 || def.spawnWeight > 1000) {
      fail(def, `spawnWeight must be a finite number in [0, 1000], got ${String(def.spawnWeight)}`);
    }
  }
  if (def.aura !== undefined) {
    checkPositive(def, "aura.radius", def.aura.radius, 32);
    // Aura multipliers must be in (0, MUL_MAX]; both directions are
    // meaningful — <1 dampens, >1 amplifies. The sim applies the strongest
    // aura of each direction (auras never stack with each other), so an
    // amplifying aura takes effect even alongside a dampening one. Exactly 0
    // is rejected: a total-silence/immunity aura is a mod bug, not balance.
    if (def.aura.damageTakenMul !== undefined) {
      checkPositive(def, "aura.damageTakenMul", def.aura.damageTakenMul, MUL_MAX);
    }
    if (def.aura.emittedSoundMul !== undefined) {
      checkPositive(def, "aura.emittedSoundMul", def.aura.emittedSoundMul, MUL_MAX);
    }
    if (def.aura.damageTakenMul === undefined && def.aura.emittedSoundMul === undefined) {
      fail(def, "aura must define at least one of damageTakenMul / emittedSoundMul");
    }
  }

  switch (def.kind) {
    case "weapon":
      checkPositive(def, "damage", def.damage, 1000);
      checkPositive(def, "cooldownS", def.cooldownS, 60);
      break;
    case "armor":
      if (def.damageTakenMul === undefined) fail(def, "armor requires damageTakenMul");
      break;
    case "boots":
      if (def.footstepMul === undefined) fail(def, "boots require footstepMul");
      break;
    case "charm":
      if (def.aura === undefined) fail(def, "charm requires an aura");
      break;
    case "consumable": {
      const hasHeal = def.healHp !== undefined;
      const hasNoise = def.noisemaker !== undefined;
      if (hasHeal === hasNoise) {
        fail(def, "consumable requires exactly one of healHp / noisemaker");
      }
      if (hasHeal) checkPositive(def, "healHp", def.healHp, 1000);
      if (hasNoise && def.noisemaker) {
        checkPositive(def, "noisemaker.durationS", def.noisemaker.durationS, 600);
        checkPositive(def, "noisemaker.intervalS", def.noisemaker.intervalS, 600);
        if (def.noisemaker.intervalS > def.noisemaker.durationS) {
          fail(def, "noisemaker.intervalS must not exceed durationS");
        }
      }
      break;
    }
  }
}

/** Validate a whole set: every def individually, plus unique ids. */
export function validateItemDefs(defs: readonly ItemDef[]): void {
  const seen = new Set<string>();
  for (const def of defs) {
    validateItemDef(def);
    if (seen.has(def.id)) {
      throw new Error(`@echowake/content: duplicate item def id "${def.id}"`);
    }
    seen.add(def.id);
  }
}

/**
 * Implicit default weapon — every player always "carries" fists. Not part of
 * ITEM_DEFS (it never spawns on the floor and occupies no inventory slot).
 */
export const FISTS: ItemDef = {
  id: "fists",
  name: "Fists",
  kind: "weapon",
  damage: 10,
  cooldownS: 0.6,
};

/** The v1 item set (README "Items & Equipment", stats pinned in docs/CONTRACTS.md). */
export const ITEM_DEFS: readonly ItemDef[] = [
  { id: "rusty-sword", name: "Rusty Sword", kind: "weapon", damage: 35, cooldownS: 0.8 },
  {
    id: "leather-armor",
    name: "Leather Armor",
    kind: "armor",
    damageTakenMul: 0.7,
    footstepMul: 1.15,
  },
  { id: "iron-armor", name: "Iron Armor", kind: "armor", damageTakenMul: 0.4, footstepMul: 1.4 },
  { id: "soft-boots", name: "Soft-Soled Boots", kind: "boots", footstepMul: 0.5 },
  {
    id: "warding-charm",
    name: "Warding Charm",
    kind: "charm",
    aura: { radius: 3, damageTakenMul: 0.75 },
  },
  {
    id: "veil-charm",
    name: "Veil Charm",
    kind: "charm",
    aura: { radius: 3, emittedSoundMul: 0.5 },
  },
  { id: "bandage", name: "Bandage", kind: "consumable", healHp: 30 },
  {
    id: "noisemaker",
    name: "Noisemaker",
    kind: "consumable",
    noisemaker: { durationS: 10, intervalS: 0.5 },
  },
];

// Fail loudly at load time — a broken def set must never reach a match.
validateItemDefs([...ITEM_DEFS, FISTS]);

const BY_ID = new Map(ITEM_DEFS.map((d) => [d.id, d]));

/** Look up a def from ITEM_DEFS by id (FISTS is implicit and not included). */
export function itemDef(id: string): ItemDef | undefined {
  return BY_ID.get(id);
}
