import { describe, expect, it } from "vitest";
import { placeCompass } from "./compass";

const W = 800;
const H = 600;
const M = 24;

describe("placeCompass", () => {
  it("returns null while the target is on screen (arrow hidden)", () => {
    expect(placeCompass(W, H, 400, 300, M)).toBeNull();
    // Edges are still "on screen".
    expect(placeCompass(W, H, 0, 0, M)).toBeNull();
    expect(placeCompass(W, H, W, H, M)).toBeNull();
  });

  it("clamps to the right edge and points right for a target off to the right", () => {
    const p = placeCompass(W, H, W + 500, H / 2, M);
    expect(p).not.toBeNull();
    expect(p!.x).toBe(W - M);
    expect(p!.y).toBe(H / 2);
    expect(p!.angle).toBeCloseTo(0, 10);
  });

  it("clamps to the top edge and points up for a target above", () => {
    const p = placeCompass(W, H, W / 2, -300, M);
    expect(p).not.toBeNull();
    expect(p!.x).toBe(W / 2);
    expect(p!.y).toBe(M);
    expect(p!.angle).toBeCloseTo(-Math.PI / 2, 10);
  });

  it("pins diagonal targets to the margin-box corner with a diagonal angle", () => {
    const p = placeCompass(W, H, -1000, H + 1000, M);
    expect(p).not.toBeNull();
    expect(p!.x).toBe(M);
    expect(p!.y).toBe(H - M);
    // Down-left quadrant: between PI/2 and PI (atan2 y-down convention).
    expect(p!.angle).toBeGreaterThan(Math.PI / 2);
    expect(p!.angle).toBeLessThanOrEqual(Math.PI);
  });
});
