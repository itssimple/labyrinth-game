import {
  BlurFilter,
  BufferImageSource,
  ColorMatrixFilter,
  Container,
  Graphics,
  Rectangle,
  RenderTexture,
  Sprite,
  Texture,
  type Renderer,
} from "pixi.js";
import {
  cellIndex,
  WALL_E,
  WALL_N,
  WALL_S,
  WALL_W,
  type Maze,
} from "@echowake/common";
import type { FogMemory } from "./fog";
import { FogMaskModel, MASK_TEXELS_PER_CELL } from "./fogmask";
import { EXIT_COLOR, FLOOR_COLOR, TILE_PX, WALL_COLOR } from "./palette";

/** World-pixel thickness of maze walls (baked into the static textures). */
export const WALL_THICKNESS = 3;
/** Cap on the baked maze texture's longest side (GPU texture-size safety). */
const MAX_BAKE_PX = 4096;
/** The blurred bake renders at this fraction of the crisp bake's size. */
const BLUR_TEX_SCALE = 0.5;
/** Blur strength (px, at blur-texture resolution) of the remembered look. */
const BLUR_STRENGTH_PX = 6;
/** ColorMatrixFilter.saturate amount for remembered areas (negative = desaturate). */
const REMEMBERED_DESATURATION = -0.45;

/**
 * Fog-of-war rendering with a CONSTANT display-object count, independent of
 * maze size and fog churn (contract "Fog rendering rewrite"):
 *
 * 1. At construction the static maze (floors, walls, exit marker) is baked
 *    ONCE into a RenderTexture, then blurred + desaturated ONCE into a
 *    second, half-resolution RenderTexture. No filter ever runs per frame.
 * 2. `root` holds exactly four display objects, bottom to top:
 *    - the blurred bake, covering the whole maze ("remembered" look);
 *    - a multiply-blend sprite of the tiny brightness mask (a few texels per
 *      cell, linear-filtered => soft edges) that dims remembered cells by
 *      age and blacks out unknown ones;
 *    - the crisp bake, alpha-masked to the currently-visible (view-cone)
 *      area, windowed to the visible cells' bounding box so the mask
 *      filter's per-frame cost tracks vision range, not maze size;
 *    - the visible-mask sprite itself (never rendered directly — Pixi
 *      excludes assigned masks from the draw list).
 * 3. `update()` re-uploads the two small mask textures only when FogMaskModel
 *    actually repainted texels (changed cells / aging), so huge maps never
 *    pay a full redraw per frame.
 *
 * Wall faces bordering a visible cell render fully bright because walls are
 * baked into the maze textures and the masks bleed one texel (more than half
 * a wall thickness) past each cell — see fogmask.ts.
 *
 * Everything here is presentation: which cells are visible comes from the
 * server's cone-filtered snapshots via FogMemory, never from local aiming.
 */
export class FogLayers {
  /** All fog display objects; add to the world below dynamic entities. */
  readonly root = new Container();

  private readonly model: FogMaskModel;
  private readonly crispTex: RenderTexture;
  private readonly blurTex: RenderTexture;
  private readonly brightnessSource: BufferImageSource;
  private readonly visibleSource: BufferImageSource;
  private readonly brightnessSprite: Sprite;
  private readonly visibleMaskSprite: Sprite;
  private readonly blurSprite: Sprite;
  private readonly crispSprite: Sprite;
  /** World px -> baked-texture px (1 unless the maze outgrows MAX_BAKE_PX). */
  private readonly bakeScale: number;
  /** Crisp window rect currently shown, in cells; -1 forces the first set. */
  private windowX0 = -1;
  private windowY0 = -1;
  private windowX1 = -1;
  private windowY1 = -1;

  constructor(renderer: Renderer, private readonly maze: Maze) {
    const worldW = maze.width * TILE_PX + WALL_THICKNESS;
    const worldH = maze.height * TILE_PX + WALL_THICKNESS;
    const half = WALL_THICKNESS / 2;
    const scale = Math.min(1, MAX_BAKE_PX / Math.max(worldW, worldH));
    this.bakeScale = scale;

    // --- Bake 1: the crisp static maze, once per match. -------------------
    const staticMaze = buildStaticMaze(maze);
    // Shift so world (-half, -half) — the outer walls' overhang — lands on
    // texel (0, 0) of the bake.
    staticMaze.scale.set(scale);
    staticMaze.position.set(half * scale, half * scale);
    this.crispTex = RenderTexture.create({
      width: Math.max(1, Math.ceil(worldW * scale)),
      height: Math.max(1, Math.ceil(worldH * scale)),
      antialias: false,
    });
    renderer.render({ container: staticMaze, target: this.crispTex, clear: true });
    staticMaze.destroy({ children: true });

    // --- Bake 2: blur + desaturate the crisp bake, once per match. --------
    // The blur input never changes, so the BlurFilter runs exactly once here
    // and is destroyed; remembered areas just sample this second texture.
    this.blurTex = RenderTexture.create({
      width: Math.max(1, Math.ceil(this.crispTex.width * BLUR_TEX_SCALE)),
      height: Math.max(1, Math.ceil(this.crispTex.height * BLUR_TEX_SCALE)),
      antialias: false,
    });
    const blurFilter = new BlurFilter({ strength: BLUR_STRENGTH_PX });
    const desatFilter = new ColorMatrixFilter();
    desatFilter.saturate(REMEMBERED_DESATURATION);
    const blurSource = new Sprite(this.crispTex);
    blurSource.filters = [blurFilter, desatFilter];
    const blurWrap = new Container();
    blurWrap.addChild(blurSource);
    blurWrap.scale.set(BLUR_TEX_SCALE);
    renderer.render({ container: blurWrap, target: this.blurTex, clear: true });
    blurWrap.destroy({ children: true });
    blurFilter.destroy();
    desatFilter.destroy();

    // --- Mask textures: a few texels per cell, straight from the model's
    // pixel buffers; linear filtering turns them into soft fog edges.
    this.model = new FogMaskModel(maze.width, maze.height);
    this.brightnessSource = new BufferImageSource({
      resource: this.model.brightnessData,
      width: this.model.texWidth,
      height: this.model.texHeight,
      format: "rgba8unorm",
      scaleMode: "linear",
    });
    this.visibleSource = new BufferImageSource({
      resource: this.model.visibleData,
      width: this.model.texWidth,
      height: this.model.texHeight,
      format: "rgba8unorm",
      scaleMode: "linear",
    });

    // --- The four permanent display objects. -------------------------------
    const texelWorld = TILE_PX / MASK_TEXELS_PER_CELL;
    const maskWorldW = maze.width * TILE_PX + 2 * texelWorld;
    const maskWorldH = maze.height * TILE_PX + 2 * texelWorld;

    this.blurSprite = new Sprite(this.blurTex);
    this.blurSprite.position.set(-half, -half);
    this.blurSprite.width = worldW;
    this.blurSprite.height = worldH;

    this.brightnessSprite = new Sprite(new Texture({ source: this.brightnessSource }));
    this.brightnessSprite.position.set(-texelWorld, -texelWorld);
    this.brightnessSprite.width = maskWorldW;
    this.brightnessSprite.height = maskWorldH;
    this.brightnessSprite.blendMode = "multiply";

    this.visibleMaskSprite = new Sprite(new Texture({ source: this.visibleSource }));
    this.visibleMaskSprite.position.set(-texelWorld, -texelWorld);
    this.visibleMaskSprite.width = maskWorldW;
    this.visibleMaskSprite.height = maskWorldH;

    this.crispSprite = new Sprite(Texture.EMPTY);
    this.crispSprite.visible = false;
    // Assigning the mask flips the mask sprite's includeInBuild off, so it
    // stays in the tree (its transform must follow the camera) but is only
    // ever sampled by the mask filter, never drawn.
    this.crispSprite.mask = this.visibleMaskSprite;

    this.root.addChild(this.blurSprite, this.brightnessSprite, this.crispSprite, this.visibleMaskSprite);
  }

  /**
   * Refreshes the masks from fog memory (time in seconds, tick-derived).
   * Cheap when nothing changed; uploads only the two tiny mask textures and
   * re-windows the crisp sprite when something did.
   */
  update(fog: FogMemory, nowS: number): void {
    if (!this.model.update(fog, nowS)) return;
    this.brightnessSource.update();
    this.visibleSource.update();
    this.updateCrispWindow();
  }

  /**
   * Points the crisp sprite's texture at the visible cells' bounding box
   * (plus one cell of margin for the mask bleed). Keeping this window small
   * keeps the per-frame mask-filter pass proportional to vision range —
   * masking the full 101x101 bake instead would filter megapixels per frame.
   */
  private updateCrispWindow(): void {
    const bounds = this.model.visibleBounds;
    if (bounds === null) {
      this.crispSprite.visible = false;
      return;
    }
    const { maze, bakeScale } = this;
    const x0 = Math.max(0, bounds.x0 - 1);
    const y0 = Math.max(0, bounds.y0 - 1);
    const x1 = Math.min(maze.width - 1, bounds.x1 + 1);
    const y1 = Math.min(maze.height - 1, bounds.y1 + 1);
    if (x0 === this.windowX0 && y0 === this.windowY0 && x1 === this.windowX1 && y1 === this.windowY1) {
      return;
    }
    this.windowX0 = x0;
    this.windowY0 = y0;
    this.windowX1 = x1;
    this.windowY1 = y1;

    // World rect of the window, including the half-wall overhang on each
    // side; texel (0,0) of the bake is world (-half, -half).
    const half = WALL_THICKNESS / 2;
    const wx0 = x0 * TILE_PX - half;
    const wy0 = y0 * TILE_PX - half;
    const frame = new Rectangle(
      x0 * TILE_PX * bakeScale,
      y0 * TILE_PX * bakeScale,
      ((x1 - x0 + 1) * TILE_PX + WALL_THICKNESS) * bakeScale,
      ((y1 - y0 + 1) * TILE_PX + WALL_THICKNESS) * bakeScale,
    );
    frame.width = Math.min(frame.width, this.crispTex.width - frame.x);
    frame.height = Math.min(frame.height, this.crispTex.height - frame.y);
    // A fresh sub-texture (shared source, no GPU work) so the sprite picks
    // up the new frame; mutating the old texture's frame in place would not
    // notify the sprite.
    const old = this.crispSprite.texture;
    this.crispSprite.texture = new Texture({ source: this.crispTex.source, frame });
    if (old !== Texture.EMPTY) old.destroy(false);
    this.crispSprite.position.set(wx0, wy0);
    this.crispSprite.scale.set(1 / bakeScale);
    this.crispSprite.visible = true;
  }

  /** Destroys the fog display objects and every baked/mask texture. */
  destroy(): void {
    const windowTexture = this.crispSprite.texture;
    const brightnessTexture = this.brightnessSprite.texture;
    const visibleTexture = this.visibleMaskSprite.texture;
    this.crispSprite.mask = null;
    this.root.destroy({ children: true });
    if (windowTexture !== Texture.EMPTY) windowTexture.destroy(false);
    brightnessTexture.destroy(false);
    visibleTexture.destroy(false);
    this.crispTex.destroy(true);
    this.blurTex.destroy(true);
    this.brightnessSource.destroy();
    this.visibleSource.destroy();
  }
}

/**
 * Builds the static maze scene that gets baked: material-tinted floors,
 * shared-edge walls and the exit marker. Anything dynamic (players, items,
 * the exit's pulse) lives in the renderer's entity layers instead.
 */
function buildStaticMaze(maze: Maze): Container {
  const container = new Container();
  const floors = new Graphics();
  const walls = new Graphics();
  const exit = new Graphics();
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
  exit
    .rect(maze.exit.x * T + pad, maze.exit.y * T + pad, T - 2 * pad, T - 2 * pad)
    .fill(EXIT_COLOR)
    .stroke({ color: 0xd9ffe4, width: 2 });
  container.addChild(floors, exit, walls);
  return container;
}
