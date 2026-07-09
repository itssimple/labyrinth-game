import { itemDef } from "@echowake/content";

/**
 * Pure HUD/input decision helpers (DOM-free, unit-tested). The session turns
 * these decisions into ActionMsg sends and store updates — no gameplay here,
 * only "which intent does this keypress express".
 */

export interface SlotPress {
  /** The slot the press selects (1-4 always select). */
  select: number;
  /** True when the slot holds a consumable — the press also fires "use". */
  use: boolean;
}

/** Keys 1-4: always select the slot; consumables are additionally used. */
export function pressSlot(inventory: readonly (string | null)[], slot: number): SlotPress {
  const id = inventory[slot] ?? null;
  const use = id !== null && itemDef(id)?.kind === "consumable";
  return { select: slot, use };
}

/**
 * Q: which slot to drop — the selected one if occupied, else the first
 * occupied slot; null when the whole inventory is empty (nothing to drop).
 */
export function dropSlotIndex(
  inventory: readonly (string | null)[],
  selected: number,
): number | null {
  if ((inventory[selected] ?? null) !== null) return selected;
  const first = inventory.findIndex((v) => v !== null);
  return first === -1 ? null : first;
}

/** True when a fresh snapshot's hp is below the previous one's (flash trigger). */
export function hpDropped(prevHp: number | null, hp: number): boolean {
  return prevHp !== null && hp < prevHp;
}
