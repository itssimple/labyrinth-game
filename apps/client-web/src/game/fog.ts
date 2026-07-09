import {
  FOG_RECENT_AFTER_S,
  FOG_STALE_AFTER_S,
  FogState,
  type FogStateId,
} from "@echowake/common";

const NEVER = Number.NEGATIVE_INFINITY;

/**
 * Client-side fog-of-war memory ("knowledge ages"). Pure TS, DOM-free.
 *
 * Cells currently in the snapshot's visible set are Visible. Once out of
 * sight a cell keeps its last-seen timestamp and ages
 * Visible -> Recent -> Stale at FOG_RECENT_AFTER_S / FOG_STALE_AFTER_S.
 * Never-seen cells are Unknown. Time is supplied by the caller in seconds
 * (the client derives it from snapshot ticks, never from the wall clock).
 */
export class FogMemory {
  private readonly lastSeen: Float64Array;
  private readonly visibleNow: Uint8Array;

  constructor(readonly cellCount: number) {
    this.lastSeen = new Float64Array(cellCount).fill(NEVER);
    this.visibleNow = new Uint8Array(cellCount);
  }

  /**
   * Replaces the currently-visible set with `visibleCells` and stamps each of
   * those cells as seen at `nowS`. Out-of-range indices are ignored.
   */
  update(visibleCells: readonly number[], nowS: number): void {
    this.visibleNow.fill(0);
    for (const i of visibleCells) {
      if (!Number.isInteger(i) || i < 0 || i >= this.cellCount) continue;
      this.visibleNow[i] = 1;
      this.lastSeen[i] = nowS;
    }
  }

  /** Fog state of cell `index` as of time `nowS` (seconds). */
  stateAt(index: number, nowS: number): FogStateId {
    if (index < 0 || index >= this.cellCount) return FogState.Unknown;
    if (this.visibleNow[index] === 1) return FogState.Visible;
    const seen = this.lastSeen[index] ?? NEVER;
    if (seen === NEVER) return FogState.Unknown;
    const elapsed = nowS - seen;
    if (elapsed < FOG_RECENT_AFTER_S) return FogState.Visible;
    if (elapsed < FOG_STALE_AFTER_S) return FogState.Recent;
    return FogState.Stale;
  }

  /** True if the cell has ever been seen (i.e. not Unknown). */
  everSeen(index: number): boolean {
    if (index < 0 || index >= this.cellCount) return false;
    return (this.lastSeen[index] ?? NEVER) !== NEVER;
  }
}
