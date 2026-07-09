import { Container, Graphics } from "pixi.js";
import { cellIndex, FogState, type FogStateId, type Maze } from "@echowake/common";
import type { FogMemory } from "./fog";
import { EXIT_COLOR, YOU_COLOR } from "./palette";

const MAX_SIDE_PX = 148;
const MARGIN = 12;
/** Aging alone (no visibility change) only needs an occasional repaint. */
const AGE_REDRAW_S = 1;

/** Fill color per fog state; -1 = draw nothing (Unknown). */
const STATE_COLOR: Readonly<Record<FogStateId, number>> = {
  [FogState.Unknown]: -1,
  [FogState.Stale]: 0x363a48,
  [FogState.Recent]: 0x5c6274,
  [FogState.Visible]: 0xb9c2d8,
};

/**
 * Corner minimap of remembered cells: brighter where currently visible, dim
 * for remembered, nothing for unknown. Shows you and (if ever seen) the exit.
 */
export class Minimap {
  readonly container = new Container();
  private readonly cellsG = new Graphics();
  private readonly youG = new Graphics();
  private readonly scale: number;
  /** Per-cell fog states computed this redraw / drawn last repaint. */
  private readonly states: Uint8Array;
  private readonly drawnStates: Uint8Array;
  private lastDrawS = Number.NEGATIVE_INFINITY;

  constructor(private readonly maze: Maze) {
    this.scale = Math.max(1, Math.floor(MAX_SIDE_PX / Math.max(maze.width, maze.height)));
    this.states = new Uint8Array(maze.width * maze.height);
    this.drawnStates = new Uint8Array(maze.width * maze.height).fill(0xff); // force first paint
    const bg = new Graphics();
    bg.rect(-3, -3, maze.width * this.scale + 6, maze.height * this.scale + 6)
      .fill({ color: 0x000000, alpha: 0.55 })
      .stroke({ color: 0x3a3d4d, width: 1 });
    this.youG.circle(0, 0, Math.max(1.5, this.scale * 0.6)).fill(YOU_COLOR);
    this.container.addChild(bg, this.cellsG, this.youG);
  }

  /** Anchors the minimap to the top-right corner of the screen. */
  layout(screenWidth: number): void {
    this.container.position.set(
      screenWidth - this.maze.width * this.scale - MARGIN,
      MARGIN + 34, // below the HUD bar
    );
  }

  /** Redraws remembered cells and the you-marker. Positions are tile units. */
  redraw(fog: FogMemory, nowS: number, youX: number, youY: number): void {
    const { maze, scale, states, drawnStates } = this;
    this.youG.position.set(youX * scale, youY * scale);

    // Recompute per-cell states and repaint only when something actually
    // changed, or on a slow timer so aging never sits on a stale picture.
    let changed = false;
    for (let i = 0; i < states.length; i++) {
      const state = fog.stateAt(i, nowS);
      states[i] = state;
      if (state !== drawnStates[i]) changed = true;
    }
    if (!changed && nowS - this.lastDrawS < AGE_REDRAW_S) return;
    drawnStates.set(states);
    this.lastDrawS = nowS;

    // One fill per horizontal run of same-color cells (the fog overlay's
    // trick) instead of one fill per explored cell.
    const g = this.cellsG;
    g.clear();
    for (let y = 0; y < maze.height; y++) {
      const row = y * maze.width;
      let runStart = 0;
      let runColor = STATE_COLOR[states[row] as FogStateId] ?? -1;
      for (let x = 1; x < maze.width; x++) {
        const color = STATE_COLOR[states[row + x] as FogStateId] ?? -1;
        if (color === runColor) continue;
        this.fillRun(runStart, x, y, runColor);
        runStart = x;
        runColor = color;
      }
      this.fillRun(runStart, maze.width, y, runColor);
    }
    const exitIdx = cellIndex(maze.width, maze.exit.x, maze.exit.y);
    if (fog.everSeen(exitIdx)) {
      g.rect(maze.exit.x * scale, maze.exit.y * scale, scale, scale).fill(EXIT_COLOR);
    }
  }

  /** Fills cells [x0, x1) of row `y` with one rect; skips Unknown runs. */
  private fillRun(x0: number, x1: number, y: number, color: number): void {
    if (color < 0 || x1 <= x0) return;
    const s = this.scale;
    this.cellsG.rect(x0 * s, y * s, (x1 - x0) * s, s).fill(color);
  }

  /** Destroys the minimap display objects. */
  destroy(): void {
    this.container.destroy({ children: true });
  }
}
