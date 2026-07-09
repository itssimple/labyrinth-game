import { describe, expect, it } from "vitest";
import { cellIndex, FOG_RECENT_AFTER_S, FOG_STALE_AFTER_S, FogState } from "@echowake/common";
import { FogMemory } from "./fog";
import {
  brightnessByte,
  FogMaskModel,
  MASK_BORDER_TEXELS,
  MASK_TEXELS_PER_CELL,
  visibleByte,
} from "./fogmask";

const W = 8;
const H = 6;

/** Byte offset of texel (tx, ty) in a model's RGBA buffers. */
function texelOffset(model: FogMaskModel, tx: number, ty: number): number {
  return (ty * model.texWidth + tx) * 4;
}

/** Texel coordinate of the center of cell (cx, cy) on one axis. */
function centerTexel(c: number): number {
  return MASK_BORDER_TEXELS + c * MASK_TEXELS_PER_CELL + Math.floor(MASK_TEXELS_PER_CELL / 2);
}

/** Reads the red channel (the mask value) of a texel from a buffer. */
function red(buf: Uint8Array, model: FogMaskModel, tx: number, ty: number): number {
  return buf[texelOffset(model, tx, ty)] ?? -1;
}

describe("mask value computation from FogState", () => {
  it("maps states to distinguishable, correctly ordered brightness bytes", () => {
    const visible = brightnessByte(FogState.Visible);
    const recent = brightnessByte(FogState.Recent);
    const stale = brightnessByte(FogState.Stale);
    const unknown = brightnessByte(FogState.Unknown);
    expect(visible).toBe(255);
    expect(unknown).toBe(0);
    expect(visible).toBeGreaterThan(recent);
    expect(recent).toBeGreaterThan(stale);
    expect(stale).toBeGreaterThan(unknown);
  });

  it("visible-layer mask is a hard in-cone bit", () => {
    expect(visibleByte(FogState.Visible)).toBe(255);
    expect(visibleByte(FogState.Recent)).toBe(0);
    expect(visibleByte(FogState.Stale)).toBe(0);
    expect(visibleByte(FogState.Unknown)).toBe(0);
  });
});

describe("FogMaskModel", () => {
  it("starts black/masked-out with constant opaque alpha", () => {
    const model = new FogMaskModel(W, H);
    expect(model.texWidth).toBe(W * MASK_TEXELS_PER_CELL + 2 * MASK_BORDER_TEXELS);
    expect(model.texHeight).toBe(H * MASK_TEXELS_PER_CELL + 2 * MASK_BORDER_TEXELS);
    for (const buf of [model.brightnessData, model.visibleData]) {
      for (let i = 0; i < buf.length; i += 4) {
        expect(buf[i]).toBe(0);
        expect(buf[i + 3]).toBe(255);
      }
    }
    expect(model.visibleBounds).toBeNull();
  });

  it("reports no change (no repaint) while everything stays unknown", () => {
    const model = new FogMaskModel(W, H);
    const fog = new FogMemory(W * H);
    expect(model.update(fog, 0)).toBe(false);
    expect(model.update(fog, 5)).toBe(false);
  });

  it("paints a visible cell to 255 in both buffers and tracks bounds", () => {
    const model = new FogMaskModel(W, H);
    const fog = new FogMemory(W * H);
    fog.update([cellIndex(W, 3, 2)], 0);
    expect(model.update(fog, 0)).toBe(true);
    const tx = centerTexel(3);
    const ty = centerTexel(2);
    expect(red(model.brightnessData, model, tx, ty)).toBe(255);
    expect(red(model.visibleData, model, tx, ty)).toBe(255);
    expect(model.visibleBounds).toEqual({ x0: 3, y0: 2, x1: 3, y1: 2 });
    // A second update at the same time changes nothing.
    expect(model.update(fog, 0)).toBe(false);
  });

  it("bounds cover all visible cells", () => {
    const model = new FogMaskModel(W, H);
    const fog = new FogMemory(W * H);
    fog.update([cellIndex(W, 1, 4), cellIndex(W, 6, 2), cellIndex(W, 3, 3)], 0);
    model.update(fog, 0);
    expect(model.visibleBounds).toEqual({ x0: 1, y0: 2, x1: 6, y1: 4 });
  });

  it("bleeds exactly one texel past a visible cell so facing walls light up", () => {
    const model = new FogMaskModel(W, H);
    const fog = new FogMemory(W * H);
    fog.update([cellIndex(W, 3, 2)], 0);
    model.update(fog, 0);
    const first = MASK_BORDER_TEXELS + 3 * MASK_TEXELS_PER_CELL; // cell block start
    const last = first + MASK_TEXELS_PER_CELL - 1; // cell block end
    const ty = centerTexel(2);
    // One texel outside the cell (over the wall line) is fully bright ...
    expect(red(model.visibleData, model, first - 1, ty)).toBe(255);
    expect(red(model.visibleData, model, last + 1, ty)).toBe(255);
    expect(red(model.brightnessData, model, first - 1, ty)).toBe(255);
    // ... but two texels outside is untouched neighbor territory.
    expect(red(model.visibleData, model, first - 2, ty)).toBe(0);
    expect(red(model.visibleData, model, last + 2, ty)).toBe(0);
  });

  it("bleed uses MAX of neighboring cells (a dim neighbor never darkens a visible edge)", () => {
    const model = new FogMaskModel(W, H);
    const fog = new FogMemory(W * H);
    // See both cells, then only keep (3,2) in sight long enough for (4,2)
    // to age to Stale: the shared boundary must stay fully bright.
    fog.update([cellIndex(W, 3, 2), cellIndex(W, 4, 2)], 0);
    model.update(fog, 0);
    const t = FOG_STALE_AFTER_S + 1;
    fog.update([cellIndex(W, 3, 2)], t);
    expect(model.update(fog, t)).toBe(true);
    const boundary = MASK_BORDER_TEXELS + 4 * MASK_TEXELS_PER_CELL; // first texel of cell 4
    const ty = centerTexel(2);
    expect(red(model.brightnessData, model, boundary, ty)).toBe(255);
    expect(red(model.visibleData, model, boundary, ty)).toBe(255);
    // Deeper inside the stale cell the brightness drops to the stale level.
    expect(red(model.brightnessData, model, centerTexel(4), ty)).toBe(brightnessByte(FogState.Stale));
    expect(red(model.visibleData, model, centerTexel(4), ty)).toBe(0);
  });

  it("ages a cell Visible -> Recent -> Stale in the brightness mask", () => {
    const model = new FogMaskModel(W, H);
    const fog = new FogMemory(W * H);
    const idx = cellIndex(W, 2, 1);
    const tx = centerTexel(2);
    const ty = centerTexel(1);
    fog.update([idx], 0);
    model.update(fog, 0);
    fog.update([], FOG_RECENT_AFTER_S); // leaves sight
    expect(model.update(fog, FOG_RECENT_AFTER_S)).toBe(true);
    expect(red(model.brightnessData, model, tx, ty)).toBe(brightnessByte(FogState.Recent));
    expect(red(model.visibleData, model, tx, ty)).toBe(0);
    // Aging alone (no fog.update) must still repaint on a later sweep.
    expect(model.update(fog, FOG_STALE_AFTER_S + 1)).toBe(true);
    expect(red(model.brightnessData, model, tx, ty)).toBe(brightnessByte(FogState.Stale));
    expect(model.visibleBounds).toBeNull();
  });

  it("repaints only cells whose state changed (changed-cell diffing)", () => {
    const model = new FogMaskModel(W, H);
    const fog = new FogMemory(W * H);
    fog.update([cellIndex(W, 1, 1), cellIndex(W, 6, 4)], 0);
    model.update(fog, 0);
    // Poison a texel in the untouched-cells region; an unrelated change must
    // not rewrite it, a change to ITS cell must.
    const px = centerTexel(6);
    const py = centerTexel(4);
    model.brightnessData[texelOffset(model, px, py)] = 123;
    fog.update([cellIndex(W, 1, 1), cellIndex(W, 6, 4), cellIndex(W, 1, 2)], 1);
    expect(model.update(fog, 1)).toBe(true); // (1,2) became visible
    expect(red(model.brightnessData, model, px, py)).toBe(123); // (6,4) untouched
    fog.update([cellIndex(W, 1, 1), cellIndex(W, 1, 2)], FOG_RECENT_AFTER_S + 1);
    expect(model.update(fog, FOG_RECENT_AFTER_S + 1)).toBe(true); // (6,4) aged
    expect(red(model.brightnessData, model, px, py)).toBe(brightnessByte(FogState.Recent));
  });

  it("clamps bleed at the maze border (border ring lights with the edge cell)", () => {
    const model = new FogMaskModel(W, H);
    const fog = new FogMemory(W * H);
    fog.update([cellIndex(W, 0, 0)], 0);
    model.update(fog, 0);
    // The outermost texel ring next to cell (0,0) takes the cell's value so
    // the maze's outer wall face lights up too.
    expect(red(model.visibleData, model, 0, 0)).toBe(255);
    expect(red(model.brightnessData, model, 0, centerTexel(0))).toBe(255);
    // The far corner of the texture stays dark.
    expect(red(model.visibleData, model, model.texWidth - 1, model.texHeight - 1)).toBe(0);
  });
});
