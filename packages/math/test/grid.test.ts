import { describe, expect, it } from "vitest";
import { gridLine } from "../src/index.js";

describe("gridLine", () => {
  it("includes both endpoints", () => {
    const cases: [number, number, number, number][] = [
      [0, 0, 5, 3],
      [5, 3, 0, 0],
      [-2, 7, 4, -1],
      [0, 0, 0, 9],
      [9, 0, 0, 0],
      [3, 3, 3, 3],
    ];
    for (const [x0, y0, x1, y1] of cases) {
      const line = gridLine(x0, y0, x1, y1);
      expect(line[0]).toEqual({ x: x0, y: y0 });
      expect(line[line.length - 1]).toEqual({ x: x1, y: y1 });
    }
  });

  it("is symmetric: reversed endpoints give the reversed cell list", () => {
    const cases: [number, number, number, number][] = [
      [0, 0, 10, 4],
      [0, 0, 4, 10],
      [-3, -3, 6, 2],
      [7, 1, 1, 7],
      [0, 0, 5, 5],
      [2, 9, 11, 3],
    ];
    for (const [x0, y0, x1, y1] of cases) {
      const forward = gridLine(x0, y0, x1, y1);
      const backward = gridLine(x1, y1, x0, y0);
      expect(backward).toEqual([...forward].reverse());
    }
  });

  it("degenerate line is a single cell", () => {
    expect(gridLine(4, -2, 4, -2)).toEqual([{ x: 4, y: -2 }]);
  });

  it("handles horizontal and vertical lines", () => {
    expect(gridLine(1, 2, 4, 2)).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
    ]);
    expect(gridLine(0, 3, 0, 0)).toEqual([
      { x: 0, y: 3 },
      { x: 0, y: 2 },
      { x: 0, y: 1 },
      { x: 0, y: 0 },
    ]);
  });

  it("handles perfect diagonals", () => {
    expect(gridLine(0, 0, 3, 3)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
  });

  it("steps are 8-connected: consecutive cells differ by at most 1 per axis", () => {
    const line = gridLine(-5, 2, 12, -7);
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!;
      const b = line[i]!;
      expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.y - a.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.x - a.x) + Math.abs(b.y - a.y)).toBeGreaterThan(0);
    }
    // Bresenham visits exactly max(|dx|, |dy|) + 1 cells.
    expect(line.length).toBe(18);
  });

  it("all cells are integers even for float-ish inputs", () => {
    const line = gridLine(0.4, 0.4, 3.4, 1.6);
    expect(line[0]).toEqual({ x: 0, y: 0 });
    expect(line[line.length - 1]).toEqual({ x: 3, y: 2 });
    for (const p of line) {
      expect(Number.isInteger(p.x)).toBe(true);
      expect(Number.isInteger(p.y)).toBe(true);
    }
  });
});
