import { Container, Graphics } from "pixi.js";
import { cellIndex, FogState, type Maze } from "@labyrinth/common";
import type { FogMemory } from "./fog";
import { EXIT_COLOR, YOU_COLOR } from "./palette";

const MAX_SIDE_PX = 148;
const MARGIN = 12;

/**
 * Corner minimap of remembered cells: brighter where currently visible, dim
 * for remembered, nothing for unknown. Shows you and (if ever seen) the exit.
 */
export class Minimap {
  readonly container = new Container();
  private readonly cellsG = new Graphics();
  private readonly youG = new Graphics();
  private readonly scale: number;

  constructor(private readonly maze: Maze) {
    this.scale = Math.max(1, Math.floor(MAX_SIDE_PX / Math.max(maze.width, maze.height)));
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
    const { maze, scale } = this;
    const g = this.cellsG;
    g.clear();
    for (let y = 0; y < maze.height; y++) {
      for (let x = 0; x < maze.width; x++) {
        const state = fog.stateAt(cellIndex(maze.width, x, y), nowS);
        if (state === FogState.Unknown) continue;
        const color =
          state === FogState.Visible ? 0xb9c2d8 : state === FogState.Recent ? 0x5c6274 : 0x363a48;
        g.rect(x * scale, y * scale, scale, scale).fill(color);
      }
    }
    const exitIdx = cellIndex(maze.width, maze.exit.x, maze.exit.y);
    if (fog.everSeen(exitIdx)) {
      g.rect(maze.exit.x * scale, maze.exit.y * scale, scale, scale).fill(EXIT_COLOR);
    }
    this.youG.position.set(youX * scale, youY * scale);
  }

  /** Destroys the minimap display objects. */
  destroy(): void {
    this.container.destroy({ children: true });
  }
}
