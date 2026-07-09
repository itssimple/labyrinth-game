import { Material, type MaterialId } from "@echowake/common";

/**
 * Seconds of continuous movement between footstep emissions, per movement
 * mode. Converted to a distance interval via MOVE_SPEED so the accumulator
 * can be tracked in tiles moved (deterministic, tick-based).
 */
export const FOOTSTEP_INTERVAL_S = {
  sneak: 0.7,
  walk: 0.45,
  sprint: 0.3,
} as const;

/**
 * Intensity lost per tile of BFS path distance travelled through open
 * passages. An intensity-1.0 sound (explosion) dies out after 20 open tiles.
 */
export const SOUND_FALLOFF_PER_TILE = 0.05;

/**
 * Intensity lost when a sound crosses one wall, by the wall's material.
 * Stone attenuates heavily, Wood medium, Metal light/resonant; the remaining
 * materials sit in between (walls of those materials are rare).
 */
export const WALL_ATTENUATION: Record<MaterialId, number> = {
  [Material.Stone]: 0.5,
  [Material.Wood]: 0.3,
  [Material.Metal]: 0.15,
  [Material.Water]: 0.35,
  [Material.Grass]: 0.4,
  [Material.Sand]: 0.45,
};

/** Auto-pickup range in tiles: walking this close to a floor item grabs it. */
export const PICKUP_RANGE = 0.5;

/**
 * A dropped item is locked against re-pickup by its dropper until the dropper
 * has moved this far from it (slightly beyond PICKUP_RANGE, hysteresis) —
 * otherwise drop would instantly bounce back into the inventory.
 */
export const DROP_RELOCK_RELEASE_RANGE = 0.75;

/** Effective intensity at or below this is inaudible (perceiveSound → null). */
export const SOUND_MIN_AUDIBLE = 0.05;

/** Perceived-position jitter radius in tiles per confidence band. */
export const SOUND_JITTER_TILES = {
  medium: 1.5,
  low: 4,
} as const;
