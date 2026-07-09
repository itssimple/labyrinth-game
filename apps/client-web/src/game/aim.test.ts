import { describe, expect, it } from "vitest";
import {
  directionToMove,
  MIN_POINTER_DIST_PX,
  pickAim,
  pointerToAim,
  readStick,
  STICK_DEADZONE,
  TOUCH_WALK_THRESHOLD,
  touchStickToMove,
} from "./aim";

describe("readStick (deadzone + normalization)", () => {
  it("returns null inside or exactly at the deadzone", () => {
    expect(readStick(0, 0)).toBeNull();
    expect(readStick(0.1, 0.1)).toBeNull(); // |v| ≈ 0.141 < 0.2
    expect(readStick(STICK_DEADZONE, 0)).toBeNull(); // boundary is dead
    expect(readStick(0, -0.19)).toBeNull();
  });

  it("normalizes direction to unit length past the deadzone", () => {
    const r = readStick(0.5, 0.5);
    expect(r).not.toBeNull();
    expect(Math.hypot(r!.x, r!.y)).toBeCloseTo(1, 10);
    expect(r!.x).toBeCloseTo(Math.SQRT1_2, 10);
    expect(r!.y).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it("rescales magnitude: deadzone edge -> 0, full push -> 1", () => {
    // raw |v| = 0.6 with dz 0.2 => (0.6 - 0.2) / 0.8 = 0.5
    expect(readStick(0.6, 0)!.magnitude).toBeCloseTo(0.5, 10);
    expect(readStick(1, 0)!.magnitude).toBeCloseTo(1, 10);
    expect(readStick(0.21, 0)!.magnitude).toBeCloseTo(0.0125, 10);
  });

  it("clamps magnitude to 1 (diagonals can exceed the unit circle)", () => {
    const r = readStick(1, 1);
    expect(r!.magnitude).toBe(1);
    expect(Math.hypot(r!.x, r!.y)).toBeCloseTo(1, 10);
  });

  it("respects a custom deadzone", () => {
    expect(readStick(0.3, 0, 0.5)).toBeNull();
    expect(readStick(0.6, 0, 0.5)).not.toBeNull();
  });

  it("rejects non-finite axes", () => {
    expect(readStick(Number.NaN, 0)).toBeNull();
    expect(readStick(Number.POSITIVE_INFINITY, 0)).toBeNull();
  });
});

describe("directionToMove (8-way discretization)", () => {
  it("maps cardinals to a single axis", () => {
    expect(directionToMove(1, 0)).toEqual({ moveX: 1, moveY: 0 });
    expect(directionToMove(-1, 0)).toEqual({ moveX: -1, moveY: 0 });
    expect(directionToMove(0, 1)).toEqual({ moveX: 0, moveY: 1 });
    expect(directionToMove(0, -1)).toEqual({ moveX: 0, moveY: -1 });
  });

  it("maps diagonals to both axes", () => {
    expect(directionToMove(1, 1)).toEqual({ moveX: 1, moveY: 1 });
    expect(directionToMove(-0.7, 0.7)).toEqual({ moveX: -1, moveY: 1 });
  });

  it("is magnitude-independent (direction only)", () => {
    expect(directionToMove(0.01, 0)).toEqual({ moveX: 1, moveY: 0 });
    expect(directionToMove(100, 100)).toEqual({ moveX: 1, moveY: 1 });
  });

  it("drops a small cross-axis component (nearly-cardinal push)", () => {
    // 10° off the x axis: y component ≈ 0.17, well under the 0.4 threshold.
    const a = (10 * Math.PI) / 180;
    expect(directionToMove(Math.cos(a), Math.sin(a))).toEqual({ moveX: 1, moveY: 0 });
  });

  it("returns idle for a zero vector", () => {
    expect(directionToMove(0, 0)).toEqual({ moveX: 0, moveY: 0 });
  });
});

describe("touchStickToMove (walk-only v1)", () => {
  it("is idle with no stick", () => {
    expect(touchStickToMove(null)).toEqual({ moveX: 0, moveY: 0 });
  });

  it("is idle at or below the walk threshold", () => {
    expect(touchStickToMove({ x: 1, y: 0, magnitude: 0.4 })).toEqual({ moveX: 0, moveY: 0 });
    expect(touchStickToMove({ x: 1, y: 0, magnitude: TOUCH_WALK_THRESHOLD })).toEqual({
      moveX: 0,
      moveY: 0,
    });
  });

  it("walks in the stick direction past the threshold", () => {
    expect(touchStickToMove({ x: 0, y: -1, magnitude: 0.8 })).toEqual({ moveX: 0, moveY: -1 });
    const d = Math.SQRT1_2;
    expect(touchStickToMove({ x: d, y: d, magnitude: 1 })).toEqual({ moveX: 1, moveY: 1 });
  });
});

describe("pointerToAim (mouse aim from the player's screen position)", () => {
  it("points from the player toward the pointer, unit length", () => {
    expect(pointerToAim(300, 200, 200, 200)).toEqual({ x: 1, y: 0 });
    const up = pointerToAim(200, 100, 200, 200);
    expect(up).toEqual({ x: 0, y: -1 });
    const diag = pointerToAim(250, 250, 200, 200)!;
    expect(diag.x).toBeCloseTo(Math.SQRT1_2, 10);
    expect(diag.y).toBeCloseTo(Math.SQRT1_2, 10);
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(1, 10);
  });

  it("works with a non-centered player position (integer camera offsets)", () => {
    // The camera rounds to integer offsets, so the sprite can sit a few px
    // off screen center — aim must use the real sprite position.
    expect(pointerToAim(500, 300, 397, 300)).toEqual({ x: 1, y: 0 });
    const aim = pointerToAim(397, 200, 397, 300)!;
    expect(aim.x).toBeCloseTo(0, 10);
    expect(aim.y).toBeCloseTo(-1, 10);
  });

  it("returns null when the pointer sits (almost) on the player", () => {
    expect(pointerToAim(200, 200, 200, 200)).toBeNull();
    expect(pointerToAim(202, 200, 200, 200)).toBeNull(); // < MIN_POINTER_DIST_PX
    expect(pointerToAim(200 + MIN_POINTER_DIST_PX, 200, 200, 200)).not.toBeNull();
  });
});

describe("pickAim (source priority)", () => {
  const g = { x: 1, y: 0 };
  const t = { x: 0, y: 1 };
  const m = { x: -1, y: 0 };

  it("gamepad beats touch beats mouse", () => {
    expect(pickAim(g, t, m)).toBe(g);
    expect(pickAim(null, t, m)).toBe(t);
    expect(pickAim(null, null, m)).toBe(m);
  });

  it("returns null when no source produced a direction", () => {
    expect(pickAim(null, null, null)).toBeNull();
  });
});
