import { FogState, Material, type FogStateId, type MaterialId } from "@echowake/common";
import type { ItemKind } from "@echowake/content";

/** World pixels per maze tile. */
export const TILE_PX = 32;

/** Floor tint per material — muted so fog states read clearly. */
export const FLOOR_COLOR: Record<MaterialId, number> = {
  [Material.Stone]: 0x3f414b,
  [Material.Wood]: 0x503a25,
  [Material.Metal]: 0x394650,
  [Material.Water]: 0x1f3a5e,
  [Material.Grass]: 0x2d4b28,
  [Material.Sand]: 0x6b5d39,
};

/** Wall tint per material — brighter than floors for contrast. */
export const WALL_COLOR: Record<MaterialId, number> = {
  [Material.Stone]: 0x8f92a0,
  [Material.Wood]: 0xa06f42,
  [Material.Metal]: 0xa4bacb,
  [Material.Water]: 0x4a7ab0,
  [Material.Grass]: 0x5f8f52,
  [Material.Sand]: 0xb3a06b,
};

export const EXIT_COLOR = 0x39d353;
export const YOU_COLOR = 0x51d0ff;
export const OTHER_COLOR = 0xff5f6d;

/** Floor-item marker color per item kind (diamond fill + HUD slot letter). */
export const ITEM_KIND_COLOR: Record<ItemKind, number> = {
  weapon: 0xffa14e,
  armor: 0x9fb6c9,
  boots: 0xc08a52,
  charm: 0xc77bff,
  consumable: 0x6fe08a,
};

/** Unknown (modded) item ids fall back to a neutral marker color. */
export const ITEM_FALLBACK_COLOR = 0xbcbcc8;

/** Alpha of remembered-item ghosts (fog overlay dims them further as it ages). */
export const ITEM_GHOST_ALPHA = 0.55;

/** Fog overlay per knowledge state (alpha 0 = fully bright / no overlay). */
export const FOG_OVERLAY: Record<FogStateId, { color: number; alpha: number }> = {
  [FogState.Visible]: { color: 0x000000, alpha: 0 },
  [FogState.Recent]: { color: 0x05060c, alpha: 0.45 },
  // Stale leans gray, approximating desaturation of the remembered tile.
  [FogState.Stale]: { color: 0x101014, alpha: 0.8 },
  [FogState.Unknown]: { color: 0x000000, alpha: 1 },
};
