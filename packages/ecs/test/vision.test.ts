import { WALL_E, cellIndex } from "@labyrinth/common";
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
