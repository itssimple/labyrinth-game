import { WALL_E, cellIndex } from "@echowake/common";
import { describe, expect, it } from "vitest";
import { computeVisibleCells } from "../src/index.js";
import { addWall, makeOpenMaze } from "./helpers.js";

describe("computeVisibleCells", () => {
  it("sees every cell of a small open maze, including its own", () => {
    const maze = makeOpenMaze(7, 7);
    const visible = computeVisibleCells(maze, 3.5, 3.5);
    expect(visible.size).toBe(49);
    expect(visible.has(cellIndex(7, 3, 3))).toBe(true);
  });

  it("is limited by VISION_RADIUS (8) from the exact position", () => {
    const maze = makeOpenMaze(25, 25);
    const visible = computeVisibleCells(maze, 12.5, 12.5);
    expect(visible.has(cellIndex(25, 20, 12))).toBe(true); // center distance 8.0
    expect(visible.has(cellIndex(25, 21, 12))).toBe(false); // center distance 9.0
    expect(visible.has(cellIndex(25, 12, 4))).toBe(true);
    expect(visible.has(cellIndex(25, 12, 3))).toBe(false);
  });

  it("walls block line of sight completely", () => {
    const maze = makeOpenMaze(7, 7);
    for (let y = 0; y < 7; y++) addWall(maze, 3, y, WALL_E); // solid wall after column 3
    const visible = computeVisibleCells(maze, 3.5, 3.5);
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        expect(visible.has(cellIndex(7, x, y))).toBe(x <= 3);
      }
    }
  });

  it("a gap in a wall lets sight through only along clear lines", () => {
    const maze = makeOpenMaze(7, 7);
    for (let y = 0; y < 7; y++) {
      if (y !== 3) addWall(maze, 3, y, WALL_E); // gap at row 3
    }
    const visible = computeVisibleCells(maze, 3.5, 3.5);
    expect(visible.has(cellIndex(7, 4, 3))).toBe(true); // straight through the gap
    expect(visible.has(cellIndex(7, 6, 3))).toBe(true);
    expect(visible.has(cellIndex(7, 4, 0))).toBe(false); // behind the wall
    expect(visible.has(cellIndex(7, 4, 6))).toBe(false);
  });

  it("returns an empty set for an out-of-bounds position", () => {
    const maze = makeOpenMaze(5, 5);
    expect(computeVisibleCells(maze, -3, 2).size).toBe(0);
  });
});

describe("computeVisibleCells with facing (view cone)", () => {
  // Player at the center of cell (12, 12) in a 25x25 open field, facing +x.
  const EAST = { x: 1, y: 0 };

  it("the standing cell is always visible, whatever the facing", () => {
    const maze = makeOpenMaze(25, 25);
    for (const facing of [EAST, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: -0.6, y: -0.8 }]) {
      expect(computeVisibleCells(maze, 12.5, 12.5, facing).has(cellIndex(25, 12, 12))).toBe(true);
    }
  });

  it("a cell straight behind is invisible beyond VISION_PERIPHERAL_RADIUS, visible within it", () => {
    const maze = makeOpenMaze(25, 25);
    const v = computeVisibleCells(maze, 12.5, 12.5, EAST);
    expect(v.has(cellIndex(25, 9, 12))).toBe(false); // center distance 3 > 2.5, dead behind
    expect(v.has(cellIndex(25, 10, 12))).toBe(true); // same direction, distance 2 <= 2.5
    // ... and sideways (90 degrees off-axis, outside the 60-degree half cone)
    expect(v.has(cellIndex(25, 12, 16))).toBe(false); // distance 4 > 2.5
    expect(v.has(cellIndex(25, 12, 14))).toBe(true); // distance 2 <= 2.5
  });

  it("full VISION_RADIUS applies inside the cone", () => {
    const maze = makeOpenMaze(25, 25);
    const v = computeVisibleCells(maze, 12.5, 12.5, EAST);
    expect(v.has(cellIndex(25, 20, 12))).toBe(true); // straight ahead, distance 8
    expect(v.has(cellIndex(25, 21, 12))).toBe(false); // distance 9 > VISION_RADIUS
  });

  it("cone boundary: cells just inside 60 degrees are visible, just outside are not (both sides)", () => {
    const maze = makeOpenMaze(25, 25);
    const v = computeVisibleCells(maze, 12.5, 12.5, EAST);
    // Angles to cell CENTERS from (12.5, 12.5), facing +x:
    expect(v.has(cellIndex(25, 15, 17))).toBe(true); // delta (3, +5): 59.04 deg
    expect(v.has(cellIndex(25, 15, 7))).toBe(true); // delta (3, -5): 59.04 deg (mirror)
    expect(v.has(cellIndex(25, 14, 16))).toBe(false); // delta (2, +4): 63.43 deg, dist 4.47 > 2.5
    expect(v.has(cellIndex(25, 14, 8))).toBe(false); // delta (2, -4): 63.43 deg (mirror)
  });

  it("cone boundary is tight: a fraction of a degree inside passes, outside fails", () => {
    const maze = makeOpenMaze(25, 25);
    // Target cell (14, 15), center (14.5, 15.5). Observer x = 12.5 => dx = 2.
    // tan(60 deg) * 2 = 3.4641: dy = 3.46 is 59.97 deg (inside), dy = 3.47 is
    // 60.07 deg (outside). Distance ~4 tiles (outside the peripheral radius).
    const inside = computeVisibleCells(maze, 12.5, 15.5 - 3.46, EAST);
    const outside = computeVisibleCells(maze, 12.5, 15.5 - 3.47, EAST);
    expect(inside.has(cellIndex(25, 14, 15))).toBe(true);
    expect(outside.has(cellIndex(25, 14, 15))).toBe(false);
  });

  it("walls still block line of sight inside the cone", () => {
    const maze = makeOpenMaze(25, 25);
    for (let y = 0; y < 25; y++) addWall(maze, 13, y, WALL_E); // solid wall after column 13
    const v = computeVisibleCells(maze, 12.5, 12.5, EAST);
    expect(v.has(cellIndex(25, 13, 12))).toBe(true); // in cone, before the wall
    for (let x = 14; x < 25; x++) {
      expect(v.has(cellIndex(25, x, 12))).toBe(false); // in cone, behind the wall
    }
  });

  it("normalizes a non-unit facing; a zero facing falls back to 360 degrees", () => {
    const maze = makeOpenMaze(25, 25);
    const unit = computeVisibleCells(maze, 12.5, 12.5, EAST);
    const scaled = computeVisibleCells(maze, 12.5, 12.5, { x: 7.5, y: 0 });
    expect([...scaled].sort()).toEqual([...unit].sort());

    const legacy = computeVisibleCells(maze, 12.5, 12.5);
    const zero = computeVisibleCells(maze, 12.5, 12.5, { x: 0, y: 0 });
    expect([...zero].sort()).toEqual([...legacy].sort());
    expect(zero.size).toBeGreaterThan(unit.size); // the cone really cuts something
  });
});
