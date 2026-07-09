import { FogState, type FogStateId } from "@echowake/common";
import { FOG_BRIGHTNESS } from "./palette";

/**
 * Pure (DOM/Pixi-free) model behind the fog-of-war render masks.
 *
 * The renderer draws the whole maze as two pre-baked textures (crisp and
 * blurred) and modulates them with two tiny mask textures whose pixel data
 * lives here:
 *
 * - `brightnessData` — multiply-blend layer: 255 where visible, the
 *   Recent/Stale dim levels where remembered, 0 (black) where unknown.
 * - `visibleData` — alpha mask of the crisp maze layer: 255 only where
 *   currently visible (in the view cone), 0 elsewhere, so remembered areas
 *   show the blurred bake instead.
 *
 * Resolution is MASK_TEXELS_PER_CELL texels per maze cell plus a one-texel
 * border, and every texel takes the MAX state of the cells within one texel
 * of it. That deliberate one-texel bleed (TILE_PX / MASK_TEXELS_PER_CELL
 * world px, comfortably more than half a wall's thickness) keeps wall faces
 * bordering a visible cell fully bright — walls are drawn ON the boundary
 * between cells, so without the bleed a wall you look straight at would sit
 * exactly on the mask's falloff midpoint and render half-dimmed. Scaled up
 * with linear filtering the mask also gives soft, stair-step-free fog edges.
 *
 * `update()` recomputes per-cell states from FogMemory (cheap) but repaints
 * texels only for cells whose state actually changed — the same discipline
 * the minimap uses — so huge maps never re-touch the full mask per call.
 */

/** Mask texels per maze cell side (higher = tighter bleed, bigger texture). */
export const MASK_TEXELS_PER_CELL = 4;
/** Extra texel ring around the maze so border-cell bleed can light outer walls. */
export const MASK_BORDER_TEXELS = 1;

/** Anything exposing FogMemory's stateAt — decoupled for tests. */
export interface FogSource {
  stateAt(index: number, nowS: number): FogStateId;
}

/** Inclusive cell-coordinate bounding box. */
export interface CellBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Multiply-layer byte (0..255) for a fog state. */
export function brightnessByte(state: FogStateId): number {
  return Math.round(FOG_BRIGHTNESS[state] * 255);
}

/** Crisp-layer (visible mask) byte for a fog state: hard in-cone bit. */
export function visibleByte(state: FogStateId): number {
  return state === FogState.Visible ? 255 : 0;
}

/** brightnessByte per state id, indexable by FogStateId (0..3). */
const BRIGHTNESS_LEVEL = new Uint8Array(4).map((_, s) => brightnessByte(s as FogStateId));

export class FogMaskModel {
  /** Mask texture width/height in texels (cells * texels-per-cell + border). */
  readonly texWidth: number;
  readonly texHeight: number;
  /** RGBA texel data of the multiply (brightness) layer. r=g=b=level, a=255. */
  readonly brightnessData: Uint8Array;
  /** RGBA texel data of the crisp-layer alpha mask. r=g=b=visible, a=255. */
  readonly visibleData: Uint8Array;
  /** Bounding box of currently-Visible cells, or null before first sight. */
  visibleBounds: CellBounds | null = null;
  /** Last-computed FogStateId per cell (starts all Unknown). */
  private readonly states: Uint8Array;
  /** Scratch list of changed cell indices, reused across updates. */
  private readonly changed: number[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.texWidth = width * MASK_TEXELS_PER_CELL + 2 * MASK_BORDER_TEXELS;
    this.texHeight = height * MASK_TEXELS_PER_CELL + 2 * MASK_BORDER_TEXELS;
    const texels = this.texWidth * this.texHeight;
    this.brightnessData = new Uint8Array(texels * 4);
    this.visibleData = new Uint8Array(texels * 4);
    // Both buffers start black/masked-out with opaque alpha: the alpha byte
    // is constant 255 forever (values live in the color channels) so blend
    // and mask sampling never involve transparency.
    for (let i = 3; i < texels * 4; i += 4) {
      this.brightnessData[i] = 255;
      this.visibleData[i] = 255;
    }
    this.states = new Uint8Array(width * height).fill(FogState.Unknown);
  }

  /**
   * Recomputes every cell's fog state at `nowS`, repaints the texels of
   * cells that changed (plus their one-texel bleed ring), and refreshes
   * `visibleBounds`. Returns true when any texels were repainted — the
   * caller only re-uploads the mask textures on true.
   */
  update(fog: FogSource, nowS: number): boolean {
    const { width, height, states, changed } = this;
    changed.length = 0;
    let vx0 = width;
    let vy0 = height;
    let vx1 = -1;
    let vy1 = -1;
    for (let y = 0, i = 0; y < height; y++) {
      for (let x = 0; x < width; x++, i++) {
        const state = fog.stateAt(i, nowS);
        if (state !== states[i]) {
          states[i] = state;
          changed.push(i);
        }
        if (state === FogState.Visible) {
          if (x < vx0) vx0 = x;
          if (x > vx1) vx1 = x;
          if (y < vy0) vy0 = y;
          if (y > vy1) vy1 = y;
        }
      }
    }
    this.visibleBounds = vx1 >= 0 ? { x0: vx0, y0: vy0, x1: vx1, y1: vy1 } : null;
    for (const i of changed) this.repaintCell(i % width, Math.floor(i / width));
    return changed.length > 0;
  }

  /** Repaints the texel block of cell (cx, cy) plus its one-texel bleed ring. */
  private repaintCell(cx: number, cy: number): void {
    const B = MASK_BORDER_TEXELS;
    const CT = MASK_TEXELS_PER_CELL;
    const tx0 = Math.max(0, B + cx * CT - 1);
    const tx1 = Math.min(this.texWidth - 1, B + (cx + 1) * CT);
    const ty0 = Math.max(0, B + cy * CT - 1);
    const ty1 = Math.min(this.texHeight - 1, B + (cy + 1) * CT);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) this.paintTexel(tx, ty);
    }
  }

  /**
   * Recomputes one texel as the MAX over every cell within one texel of it
   * (its own cell, plus the neighbor across an edge/corner for boundary
   * texels) — this is what makes the mask bleed across walls.
   */
  private paintTexel(tx: number, ty: number): void {
    const { width, states } = this;
    const cx0 = this.cellAt(tx - 1, this.width);
    const cx1 = this.cellAt(tx + 1, this.width);
    const cy0 = this.cellAt(ty - 1, this.height);
    const cy1 = this.cellAt(ty + 1, this.height);
    let bright = 0;
    let visible = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const state = states[cy * width + cx] as FogStateId;
        const level = BRIGHTNESS_LEVEL[state] ?? 0;
        if (level > bright) bright = level;
        if (state === FogState.Visible) visible = 255;
      }
    }
    const o = (ty * this.texWidth + tx) * 4;
    this.brightnessData[o] = bright;
    this.brightnessData[o + 1] = bright;
    this.brightnessData[o + 2] = bright;
    this.visibleData[o] = visible;
    this.visibleData[o + 1] = visible;
    this.visibleData[o + 2] = visible;
  }

  /** Cell index owning texel position `t` on one axis, clamped into the maze. */
  private cellAt(t: number, cells: number): number {
    const c = Math.floor((t - MASK_BORDER_TEXELS) / MASK_TEXELS_PER_CELL);
    return c < 0 ? 0 : c >= cells ? cells - 1 : c;
  }
}
