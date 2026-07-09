import { describe, expect, it } from "vitest";
import { clamp, distSq } from "../src/index.js";

describe("clamp", () => {
  it("passes values inside the range through", () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(-3, -10, 10)).toBe(-3);
  });

  it("clamps to min and max", () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(-Infinity, 0, 1)).toBe(0);
    expect(clamp(Infinity, 0, 1)).toBe(1);
  });

  it("returns the boundary at the boundary", () => {
    expect(clamp(0, 0, 1)).toBe(0);
    expect(clamp(1, 0, 1)).toBe(1);
  });
});

describe("distSq", () => {
  it("is zero for identical points", () => {
    expect(distSq(3.5, -2, 3.5, -2)).toBe(0);
  });

  it("matches squared Euclidean distance", () => {
    expect(distSq(0, 0, 3, 4)).toBe(25);
    expect(distSq(3, 4, 0, 0)).toBe(25);
    expect(distSq(-1, -1, 2, 3)).toBe(25);
    expect(distSq(0.5, 0.5, 1.5, 0.5)).toBe(1);
  });
});
