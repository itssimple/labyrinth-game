import { Application, Container, Graphics, Text, type Ticker } from "pixi.js";
import { cellIndex, FogState, TICK_RATE, type Maze } from "@echowake/common";
import type { AudioEngine } from "../audio/engine";
import type { MatchView } from "./state";
import { placeCompass } from "./compass";
import { FogLayers } from "./foglayers";
import { itemColor, itemInitial } from "./items";
import { Minimap } from "./minimap";
import { RippleField } from "./ripples";
import {
  EXIT_COLOR,
  ITEM_GHOST_ALPHA,
  OTHER_COLOR,
  TILE_PX,
  YOU_COLOR,
} from "./palette";

const FOG_REDRAW_MIN_MS = 90;
/**
 * Even without snapshots (fogDirty), refresh fog + minimap about once a
 * second so Visible -> Recent -> Stale aging never sits on a stale picture.
 */
const FOG_AGE_SWEEP_MS = 1000;
/** Inset of the exit-compass arrow from the screen edges. */
const COMPASS_MARGIN_PX = 26;
/** Reporting window of the HUD FPS counter. */
const FPS_WINDOW_MS = 1000;

/** Presentation-only callbacks out of the renderer (HUD numbers etc.). */
export interface RendererHooks {
  /** Called about once per second with the measured frames-per-second. */
  onFps?: (fps: number) => void;
}

/** Floor-item marker: a small kind-colored diamond with the item's initial. */
function makeItemNode(itemId: string): Container {
  const node = new Container();
  const r = TILE_PX * 0.3;
  const g = new Graphics();
  g.poly([0, -r, r, 0, 0, r, -r, 0])
    .fill(itemColor(itemId))
    .stroke({ color: 0xffffff, width: 1.5, alpha: 0.8 });
  const label = new Text({
    text: itemInitial(itemId),
    style: { fontFamily: "monospace", fontSize: 11, fontWeight: "bold", fill: 0x0a0a0f },
  });
  label.anchor.set(0.5);
  node.addChild(g, label);
  return node;
}

/**
 * PixiJS game renderer. Owns the Application, world layers, fog treatment,
 * ripples and minimap. Purely observes the MatchView each frame — it holds
 * no gameplay state of its own.
 *
 * Fog of war renders through FogLayers (baked maze textures + tiny mask
 * textures — constant display-object count regardless of maze size); this
 * class just feeds it FogMemory on the throttled redraw cadence. Dynamic
 * entities (players, items, ripples, the exit pulse) always sit ABOVE the
 * fog treatment: the server already filters them to the view cone, so they
 * render crisp and undimmed whenever they exist at all.
 */
export class GameRenderer {
  private readonly world = new Container();
  private readonly fogLayers: FogLayers;
  private readonly youG = new Graphics();
  /** Facing indicator: short wedge on your sprite (presentation only). */
  private readonly facingG = new Graphics();
  /** Exit pulse: animated highlight shown only while the exit cell is visible. */
  private readonly exitG = new Graphics();
  private readonly exitIndex: number;
  private readonly othersLayer = new Container();
  private readonly otherDots = new Map<string, Graphics>();
  private readonly itemsLayer = new Container();
  private readonly itemNodes = new Map<number, Container>();
  private readonly ripples = new RippleField();
  private readonly minimap: Minimap;
  /** Exit compass: screen-space HUD arrow, world-independent. */
  private readonly compassG = new Graphics();
  private lastFogRedrawMs = -Infinity;
  private fpsFrames = 0;
  private fpsWindowStartMs = performance.now();
  private readonly frame = (ticker: Ticker) => this.onFrame(ticker);

  /** Creates the Pixi Application (async in v8) and mounts its canvas. */
  static async create(
    container: HTMLElement,
    match: MatchView,
    audio: AudioEngine,
    hooks: RendererHooks = {},
  ): Promise<GameRenderer> {
    const app = new Application();
    await app.init({
      resizeTo: container,
      backgroundColor: 0x0a0a0f,
      antialias: false,
      roundPixels: true,
    });
    container.appendChild(app.canvas);
    return new GameRenderer(app, match, audio, hooks);
  }

  private constructor(
    private readonly app: Application,
    private readonly match: MatchView,
    private readonly audio: AudioEngine,
    private readonly hooks: RendererHooks,
  ) {
    // Bakes the static maze (crisp + blurred) once and owns the fog masks.
    this.fogLayers = new FogLayers(app.renderer, match.maze);
    this.exitIndex = cellIndex(match.maze.width, match.maze.exit.x, match.maze.exit.y);
    this.youG.circle(0, 0, TILE_PX * 0.35).fill(YOU_COLOR).stroke({ color: 0xffffff, width: 2 });
    // Subtle direction wedge pointing +x; rotated to the local facing each
    // frame. Sits just outside the body circle so it reads as a "nose".
    const r = TILE_PX * 0.35;
    this.facingG
      .poly([r + 7, 0, r - 2, 5, r - 2, -5])
      .fill({ color: 0xffffff, alpha: 0.85 });
    this.facingG.visible = false;
    this.youG.addChild(this.facingG);
    this.drawExitPulse(match.maze);
    // Kite-shaped arrow pointing +x; placeCompass supplies the rotation.
    this.compassG
      .poly([14, 0, -9, 9, -4, 0, -9, -9])
      .fill(EXIT_COLOR)
      .stroke({ color: 0xd9ffe4, width: 1.5 });
    this.compassG.visible = false;

    // Order: the fog-treated maze at the bottom, then every dynamic entity
    // ABOVE the fog so nothing the server chose to show is ever dimmed:
    // exit pulse (visibility-gated), items, other players, you, ripples.
    this.world.addChild(
      this.fogLayers.root,
      this.exitG,
      this.itemsLayer,
      this.othersLayer,
      this.youG,
      this.ripples.container,
    );
    this.minimap = new Minimap(match.maze);
    // HUD layer sits above the world: compass arrow, then the minimap.
    app.stage.addChild(this.world, this.compassG, this.minimap.container);
    app.ticker.add(this.frame);
  }

  /** Animated exit highlight, same geometry as the baked static marker. */
  private drawExitPulse(maze: Maze): void {
    const pad = 4;
    this.exitG
      .rect(maze.exit.x * TILE_PX + pad, maze.exit.y * TILE_PX + pad, TILE_PX - 2 * pad, TILE_PX - 2 * pad)
      .fill(EXIT_COLOR)
      .stroke({ color: 0xd9ffe4, width: 2 });
    this.exitG.visible = false;
  }

  private onFrame(ticker: Ticker): void {
    const match = this.match;
    const nowMs = performance.now();
    const nowS = match.latestTick / TICK_RATE;
    const you = match.you.posAt(nowMs) ?? { x: 0.5, y: 0.5 };

    // FPS: count rendered frames over a rolling ~1s window, then report.
    this.fpsFrames++;
    const windowMs = nowMs - this.fpsWindowStartMs;
    if (windowMs >= FPS_WINDOW_MS) {
      this.hooks.onFps?.(Math.round((this.fpsFrames * 1000) / windowMs));
      this.fpsFrames = 0;
      this.fpsWindowStartMs = nowMs;
    }

    // Camera: center on you, integer offsets for a crisp pixel look.
    this.world.position.set(
      Math.round(this.app.screen.width / 2 - you.x * TILE_PX),
      Math.round(this.app.screen.height / 2 - you.y * TILE_PX),
    );
    this.youG.position.set(you.x * TILE_PX, you.y * TILE_PX);
    const facing = match.localFacing;
    this.facingG.visible = facing !== null;
    if (facing !== null) this.facingG.rotation = Math.atan2(facing.y, facing.x);
    // The exit pulse is a dynamic entity above the fog: show it only while
    // the exit cell is actually in sight (its remembered look is the baked
    // static marker under the fog treatment) — never a wallhack.
    this.exitG.visible = match.fog.stateAt(this.exitIndex, nowS) === FogState.Visible;
    this.exitG.alpha = 0.65 + 0.35 * Math.sin(nowMs / 280);

    this.syncOthers(nowMs);
    this.syncItems();

    // New perceived sounds -> ripples; skip anything older than a second of
    // ticks (a hidden tab stops draining while snapshots keep arriving).
    if (match.soundQueue.length > 0) {
      const minTick = match.latestTick - TICK_RATE;
      for (const s of match.soundQueue.splice(0)) {
        if (s.tick < minTick) continue;
        // Sight + sound together: the same perceived event draws a ripple and
        // plays positionally (panned/attenuated relative to where you are).
        this.ripples.spawn(s);
        this.audio.playPerceived(s, you.x, you.y);
      }
    }
    this.ripples.update(ticker.deltaMS);

    // Fog + minimap refresh, throttled; time comes from ticks, not wall
    // clock. Snapshots mark fogDirty; the age sweep keeps knowledge aging
    // even when no snapshot arrives. Both paths only repaint cells whose
    // state actually changed (FogMaskModel / the minimap diff internally).
    const sinceRedrawMs = nowMs - this.lastFogRedrawMs;
    if ((match.fogDirty && sinceRedrawMs >= FOG_REDRAW_MIN_MS) || sinceRedrawMs >= FOG_AGE_SWEEP_MS) {
      match.fogDirty = false;
      this.lastFogRedrawMs = nowMs;
      this.fogLayers.update(match.fog, nowS);
      this.minimap.redraw(match.fog, nowS, you.x, you.y);
    }
    this.minimap.layout(this.app.screen.width);
    this.updateCompass(nowMs);
  }

  /**
   * Exit compass: edge-of-screen arrow toward the exit, shown only once the
   * exit cell has entered this client's OWN fog memory (Visible or any
   * remembered state) and only while the exit is off-screen. Derives nothing
   * from server data beyond the fog memory itself — no wallhack.
   */
  private updateCompass(nowMs: number): void {
    const { maze, fog } = this.match;
    if (!fog.everSeen(this.exitIndex)) {
      this.compassG.visible = false;
      return;
    }
    // Screen-space exit position; the camera keeps "you" at screen center,
    // so pointing from the center is pointing from your position.
    const placed = placeCompass(
      this.app.screen.width,
      this.app.screen.height,
      this.world.position.x + (maze.exit.x + 0.5) * TILE_PX,
      this.world.position.y + (maze.exit.y + 0.5) * TILE_PX,
      COMPASS_MARGIN_PX,
    );
    if (placed === null) {
      this.compassG.visible = false;
      return;
    }
    this.compassG.visible = true;
    this.compassG.position.set(placed.x, placed.y);
    this.compassG.rotation = placed.angle;
    this.compassG.alpha = 0.7 + 0.3 * Math.sin(nowMs / 280); // pulse like the exit tile
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

  /** Reconciles diamond markers for live floor items + remembered ghosts. */
  private syncItems(): void {
    const views = this.match.items.list();
    const seen = new Set<number>();
    for (const v of views) {
      seen.add(v.id);
      let node = this.itemNodes.get(v.id);
      if (node === undefined) {
        node = makeItemNode(v.item);
        this.itemNodes.set(v.id, node);
        this.itemsLayer.addChild(node);
      }
      node.position.set(v.x * TILE_PX, v.y * TILE_PX);
      // Ghosts get their own fixed dimming; they sit above the fog layers,
      // so the "remembered, may be gone" look never depends on cell aging.
      node.alpha = v.ghost ? ITEM_GHOST_ALPHA : 1;
    }
    for (const [id, node] of this.itemNodes) {
      if (!seen.has(id)) {
        node.destroy({ children: true });
        this.itemNodes.delete(id);
      }
    }
  }

  /**
   * Your sprite's current on-screen position in canvas pixel coordinates:
   * the world layer's (integer, camera-rounded) offset plus your world
   * position — exactly what is drawn, so mouse aim stays correct even with
   * the integer camera offsets (screen center is only an approximation).
   */
  youScreenPos(): { x: number; y: number } {
    return {
      x: this.world.position.x + this.youG.position.x,
      y: this.world.position.y + this.youG.position.y,
    };
  }

  /** Tears down the Pixi application and all display objects. */
  destroy(): void {
    this.app.ticker.remove(this.frame);
    this.ripples.destroy();
    this.minimap.destroy();
    this.fogLayers.destroy();
    this.app.destroy(true, { children: true, texture: true });
  }
}
