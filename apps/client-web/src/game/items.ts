import { itemDef, type ItemKind } from "@echowake/content";
import { ITEM_FALLBACK_COLOR, ITEM_KIND_COLOR } from "./palette";

/** Minimal shape of a snapshot floor item (structurally matches VisibleItemState). */
export interface VisibleItemLike {
  /** Server-side item instance id (stable while it lies there). */
  id: number;
  /** Item definition id from @echowake/content (e.g. "rusty-sword"). */
  item: string;
  x: number;
  y: number;
}

/** One remembered or currently-visible floor item, ready to render. */
export interface ItemView {
  id: number;
  item: string;
  x: number;
  y: number;
  /** True when remembered but not in the latest snapshot (render dimmed). */
  ghost: boolean;
}

interface RememberedItem extends VisibleItemLike {
  /** Row-major cell index of the item's position (for forget checks). */
  cell: number;
}

/**
 * Client-side floor-item memory, mirroring FogMemory ("knowledge ages"):
 * an item you have seen stays rendered as a dimmed ghost after it leaves
 * sight, and is forgotten only once its cell re-enters sight WITHOUT the
 * item (someone picked it up, or it was never coming back). Pure TS,
 * DOM-free — the renderer only reads `list()`.
 */
export class ItemMemory {
  private readonly remembered = new Map<number, RememberedItem>();
  private visibleIds = new Set<number>();

  constructor(private readonly mazeWidth: number) {}

  /**
   * Feeds one snapshot: the items currently in line of sight plus the cells
   * currently visible. Remembered items on a visible cell that are absent
   * from `items` are forgotten (the ground truth contradicts the memory).
   */
  update(items: readonly VisibleItemLike[], visibleCells: readonly number[]): void {
    this.visibleIds = new Set<number>();
    for (const it of items) {
      this.visibleIds.add(it.id);
      this.remembered.set(it.id, {
        id: it.id,
        item: it.item,
        x: it.x,
        y: it.y,
        cell: Math.floor(it.y) * this.mazeWidth + Math.floor(it.x),
      });
    }
    if (this.remembered.size === this.visibleIds.size) return; // nothing to forget
    const seen = new Set(visibleCells);
    for (const [id, r] of this.remembered) {
      if (!this.visibleIds.has(id) && seen.has(r.cell)) this.remembered.delete(id);
    }
  }

  /** Everything to render: live items (ghost=false) plus remembered ghosts. */
  list(): ItemView[] {
    const out: ItemView[] = [];
    for (const r of this.remembered.values()) {
      out.push({ id: r.id, item: r.item, x: r.x, y: r.y, ghost: !this.visibleIds.has(r.id) });
    }
    return out;
  }
}

// --- display helpers (presentation-only lookups over @echowake/content) -----

/** Display name for an item definition id; falls back to the raw id (mods). */
export function itemName(id: string): string {
  return itemDef(id)?.name ?? id;
}

/** Single uppercase initial shown on the item marker / inventory slot. */
export function itemInitial(id: string): string {
  return itemName(id).charAt(0).toUpperCase();
}

/** Marker color by item kind (unknown modded ids get a neutral fallback). */
export function itemColor(id: string): number {
  const kind: ItemKind | undefined = itemDef(id)?.kind;
  return kind === undefined ? ITEM_FALLBACK_COLOR : ITEM_KIND_COLOR[kind];
}

/** CSS hex string of itemColor, for the React HUD. */
export function itemColorCss(id: string): string {
  return `#${itemColor(id).toString(16).padStart(6, "0")}`;
}
