import { Application, Container, Graphics, type Ticker } from "pixi.js";
import {
  cellIndex,
  FogState,
  TICK_RATE,
  WALL_E,
  WALL_N,
  WALL_S,
  WALL_W,
  type FogStateId,
  type Maze,
} from "@labyrinth/common";
import type { MatchView } from "./state";
import { Minimap } from "./minimap";
import { RippleField } from "./ripples";
import { EXIT_COLOR, FLOOR_COLOR, FOG_OVERLAY, OTHER_COLOR, TILE_PX, WALL_COLOR, YOU_COLOR } from "./palette";

const WALL_THICKNESS = 3;
const FOG_REDRAW_MIN_MS = 90;

/** Draws the static maze layer: material-tinted floors, walls, exit marker. */
function drawMaze(floors: Graphics, walls: Graphics, exitG: Graphics, maze: Maze): void {
  const T = TILE_PX;
  for (let y = 0; y < maze.height; y++) {
    for (let x = 0; x < maze.width; x++) {
      const cell = maze.cells[cellIndex(maze.width, x, y)];
      if (cell === undefined) continue;
      floors.rect(x * T, y * T, T, T).fill(FLOOR_COLOR[cell.floor]);
    }
  }
  // Draw N + W per cell (plus S/E on the outer border) so shared walls draw once.
  const half = WALL_THICKNESS / 2;
  for (let y = 0; y < maze.height; y++) {
    for (let x = 0; x < maze.width; x++) {
      const cell = maze.cells[cellIndex(maze.width, x, y)];
      if (cell === undefined) continue;
      const color = WALL_COLOR[cell.wallMaterial];
      if (cell.walls & WALL_N) walls.rect(x * T - half, y * T - half, T + WALL_THICKNESS, WALL_THICKNESS).fill(color);
      if (cell.walls & WALL_W) walls.rect(x * T - half, y * T - half, WALL_THICKNESS, T + WALL_THICKNESS).fill(color);
      if (y === maze.height - 1 && cell.walls & WALL_S)
        walls.rect(x * T - half, (y + 1) * T - half, T + WALL_THICKNESS, WALL_THICKNESS).fill(color);
      if (x === maze.width - 1 && cell.walls & WALL_E)
        walls.rect((x + 1) * T - half, y * T - half, WALL_THICKNESS, T + WALL_THICKNESS).fill(color);
    }
  }
  const pad = 4;
  exitG
    .rect(maze.exit.x * T + pad, maze.exit.y * T + pad, T - 2 * pad, T - 2 * pad)
    .fill(EXIT_COLOR)
    .stroke({ color: 0xd9ffe4, width: 2 });
}

/**
 * PixiJS game renderer. Owns the Application, world layers, fog overlay,
 * ripples and minimap. Purely observes the MatchView each frame — it holds
 * no gameplay state of its own.
 */
export class GameRenderer {
  private readonly world = new Container();
  private readonly fogG = new Graphics();
  private readonly youG = new Graphics();
  private readonly exitG = new Graphics();
  private readonly othersLayer = new Container();
  private readonly otherDots = new Map<string, Graphics>();
  private readonly ripples = new RippleField();
  private readonly minimap: Minimap;
  private lastFogRedrawMs = -Infinity;
  private readonly frame = (ticker: Ticker) => this.onFrame(ticker);

  /** Creates the Pixi Application (async in v8) and mounts its canvas. */
  static async create(container: HTMLElement, match: MatchView): Promise<GameRenderer> {
    const app = new Application();
    await app.init({
      resizeTo: container,
      backgroundColor: 0x0a0a0f,
      antialias: false,
      roundPixels: true,
    });
    container.appendChild(app.canvas);
    return new GameRenderer(app, match);
  }

  private constructor(
    private readonly app: Application,
    private readonly match: MatchView,
  ) {
    const floors = new Graphics();
    const walls = new Graphics();
    drawMaze(floors, walls, this.exitG, match.maze);
    this.youG.circle(0, 0, TILE_PX * 0.35).fill(YOU_COLOR).stroke({ color: 0xffffff, width: 2 });

    // Order: floors, exit, walls, players, fog, then ripples above the fog.
    this.world.addChild(floors, this.exitG, walls, this.othersLayer, this.youG, this.fogG, this.ripples.container);
    this.minimap = new Minimap(match.maze);
    app.stage.addChild(this.world, this.minimap.container);
    app.ticker.add(this.frame);
  }

  private onFrame(ticker: Ticker): void {
    const match = this.match;
    const nowMs = performance.now();
    const you = match.you.posAt(nowMs) ?? { x: 0.5, y: 0.5 };

    // Camera: center on you, integer offsets for a crisp pixel look.
    this.world.position.set(
      Math.round(this.app.screen.width / 2 - you.x * TILE_PX),
      Math.round(this.app.screen.height / 2 - you.y * TILE_PX),
    );
    this.youG.position.set(you.x * TILE_PX, you.y * TILE_PX);
    this.exitG.alpha = 0.65 + 0.35 * Math.sin(nowMs / 280);

    this.syncOthers(nowMs);

    // New perceived sounds -> ripples.
    if (match.soundQueue.length > 0) {
      for (const s of match.soundQueue.splice(0)) this.ripples.spawn(s);
    }
    this.ripples.update(ticker.deltaMS);

    // Fog + minimap redraw, throttled; time comes from ticks, not wall clock.
    if (match.fogDirty && nowMs - this.lastFogRedrawMs >= FOG_REDRAW_MIN_MS) {
      match.fogDirty = false;
      this.lastFogRedrawMs = nowMs;
      const nowS = match.latestTick / TICK_RATE;
      this.redrawFog(nowS);
      this.minimap.redraw(match.fog, nowS, you.x, you.y);
    }
    this.minimap.layout(this.app.screen.width);
  }

  /** Reconciles circles for currently-visible other players. */
  private syncOthers(nowMs: number): void {
    const visible = this.match.others.visibleAt(nowMs);
    const seen = new Set<string>();
    for (const p of visible) {
      seen.add(p.id);
      let dot = this.otherDots.get(p.id);
      if (dot === undefined) {
        dot = new Graphics();
        dot.circle(0, 0, TILE_PX * 0.35).fill(OTHER_COLOR).stroke({ color: 0xffd9dd, width: 2 });
        this.otherDots.set(p.id, dot);
        this.othersLayer.addChild(dot);
      }
      dot.position.set(p.x * TILE_PX, p.y * TILE_PX);
    }
    for (const [id, dot] of this.otherDots) {
      if (!seen.has(id)) {
        dot.destroy();
        this.otherDots.delete(id);
      }
    }
  }

  /** Redraws the fog overlay, merging same-state runs per row into one rect. */
  private redrawFog(nowS: number): void {
    const { maze, fog } = this.match;
    const g = this.fogG;
    g.clear();
    for (let y = 0; y < maze.height; y++) {
      let runStart = 0;
      let runState: FogStateId = fog.stateAt(cellIndex(maze.width, 0, y), nowS);
      for (let x = 1; x <= maze.width; x++) {
        const state: FogStateId =
          x < maze.width ? fog.stateAt(cellIndex(maze.width, x, y), nowS) : FogState.Visible;
        if (state === runState) continue;
        this.fillFogRun(g, runStart, x, y, runState);
        runStart = x;
        runState = state;
      }
      this.fillFogRun(g, runStart, maze.width, y, runState);
    }
  }

  private fillFogRun(g: Graphics, x0: number, x1: number, y: number, state: FogStateId): void {
    if (x1 <= x0) return;
    const { color, alpha } = FOG_OVERLAY[state];
    if (alpha <= 0) return;
    // Slight overdraw hides seams between fog rects and covers wall edges.
    g.rect(x0 * TILE_PX - 2, y * TILE_PX - 2, (x1 - x0) * TILE_PX + 4, TILE_PX + 4).fill({
      color,
      alpha,
    });
  }

  /** Tears down the Pixi application and all display objects. */
  destroy(): void {
    this.app.ticker.remove(this.frame);
    this.ripples.destroy();
    this.minimap.destroy();
    this.app.destroy(true, { children: true, texture: true });
  }
}
