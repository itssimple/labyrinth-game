import { describe, expect, it } from "vitest";
import {
  MAX_PLAYERS,
  MAZE_DIMENSIONS,
  WALL_E,
  WALL_N,
  WALL_S,
  WALL_W,
  cellIndex,
  type Maze,
  type MazeSize,
} from "@echowake/common";
import { generateMaze } from "../src/index.js";

const SIZES = Object.keys(MAZE_DIMENSIONS) as MazeSize[];

/** BFS through open passages; returns number of reachable cells from (0,0). */
function countReachable(maze: Maze): number {
  const seen = new Uint8Array(maze.width * maze.height);
  const queue = [0];
  seen[0] = 1;
  let head = 0;
  while (head < queue.length) {
    const index = queue[head++]!;
    const x = index % maze.width;
    const y = Math.floor(index / maze.width);
    const walls = maze.cells[index]!.walls;
    const step = (blocked: number, nx: number, ny: number) => {
      if (blocked) return;
      const ni = cellIndex(maze.width, nx, ny);
      if (!seen[ni]) {
        seen[ni] = 1;
        queue.push(ni);
      }
    };
    step(walls & WALL_N, x, y - 1);
    step(walls & WALL_E, x + 1, y);
    step(walls & WALL_S, x, y + 1);
    step(walls & WALL_W, x - 1, y);
  }
  return queue.length;
}

/** Count interior wall pairs still present (each shared wall once). */
function countInteriorWalls(maze: Maze): number {
  let count = 0;
  for (let y = 0; y < maze.height; y++) {
    for (let x = 0; x < maze.width; x++) {
      const walls = maze.cells[cellIndex(maze.width, x, y)]!.walls;
      if (x < maze.width - 1 && walls & WALL_E) count++;
      if (y < maze.height - 1 && walls & WALL_S) count++;
    }
  }
  return count;
}

describe("generateMaze determinism", () => {
  it("same options produce deep-equal mazes", () => {
    const a = generateMaze({ seed: "alpha", size: "small", difficulty: 0.3 });
    const b = generateMaze({ seed: "alpha", size: "small", difficulty: 0.3 });
    expect(b).toEqual(a);
  });

  it("difficulty defaults to 0.5", () => {
    const implicit = generateMaze({ seed: "alpha", size: "tiny" });
    const explicit = generateMaze({ seed: "alpha", size: "tiny", difficulty: 0.5 });
    expect(explicit).toEqual(implicit);
  });

  it("different seeds produce different mazes", () => {
    const a = generateMaze({ seed: "alpha", size: "small" });
    const b = generateMaze({ seed: "beta", size: "small" });
    expect(b.cells).not.toEqual(a.cells);
  });

  it("modifiers deterministically change the maze", () => {
    const plain = generateMaze({ seed: "alpha", size: "tiny" });
    const modded = generateMaze({ seed: "alpha", size: "tiny", modifiers: ["dark"] });
    const moddedAgain = generateMaze({ seed: "alpha", size: "tiny", modifiers: ["dark"] });
    expect(modded.cells).not.toEqual(plain.cells);
    expect(moddedAgain).toEqual(modded);
  });
});

describe("generateMaze dimensions", () => {
  for (const size of SIZES) {
    it(`size "${size}" matches MAZE_DIMENSIONS`, () => {
      const { width, height } = MAZE_DIMENSIONS[size];
      const maze = generateMaze({ seed: "dims", size });
      expect(maze.width).toBe(width);
      expect(maze.height).toBe(height);
      expect(maze.cells).toHaveLength(width * height);
      expect(maze.seed).toBe("dims");
    });
  }
});

describe("generateMaze connectivity", () => {
  for (const size of SIZES) {
    it(`every cell is reachable (${size})`, () => {
      const maze = generateMaze({ seed: `conn-${size}`, size });
      expect(countReachable(maze)).toBe(maze.width * maze.height);
    });
  }
});

describe("generateMaze wall consistency", () => {
  it.each(["w1", "w2", "w3"])("neighbors agree and borders are present (seed %s)", (seed) => {
    const maze = generateMaze({ seed, size: "small" });
    for (let y = 0; y < maze.height; y++) {
      for (let x = 0; x < maze.width; x++) {
        const walls = maze.cells[cellIndex(maze.width, x, y)]!.walls;
        // Borders always present.
        if (y === 0) expect(walls & WALL_N).toBeTruthy();
        if (y === maze.height - 1) expect(walls & WALL_S).toBeTruthy();
        if (x === 0) expect(walls & WALL_W).toBeTruthy();
        if (x === maze.width - 1) expect(walls & WALL_E).toBeTruthy();
        // Shared walls agree with neighbors.
        if (x < maze.width - 1) {
          const east = maze.cells[cellIndex(maze.width, x + 1, y)]!.walls;
          expect(Boolean(walls & WALL_E)).toBe(Boolean(east & WALL_W));
        }
        if (y < maze.height - 1) {
          const south = maze.cells[cellIndex(maze.width, x, y + 1)]!.walls;
          expect(Boolean(walls & WALL_S)).toBe(Boolean(south & WALL_N));
        }
      }
    }
  });
});

describe("generateMaze loop carving", () => {
  it("lower difficulty removes more interior walls", () => {
    const hard = generateMaze({ seed: "loops", size: "medium", difficulty: 1 });
    const easy = generateMaze({ seed: "loops", size: "medium", difficulty: 0 });
    expect(countInteriorWalls(easy)).toBeLessThan(countInteriorWalls(hard));
  });

  it("difficulty 1 keeps the maze perfect (walls = cells - 1 passages)", () => {
    const maze = generateMaze({ seed: "perfect", size: "small", difficulty: 1 });
    const cellCount = maze.width * maze.height;
    const interiorPairs = (maze.width - 1) * maze.height + maze.width * (maze.height - 1);
    // A perfect maze has exactly cellCount - 1 open passages.
    expect(countInteriorWalls(maze)).toBe(interiorPairs - (cellCount - 1));
  });
});

describe("generateMaze spawns and exit", () => {
  it("has 16 distinct in-bounds spawns, spread apart", () => {
    const maze = generateMaze({ seed: "spawns", size: "medium" });
    expect(maze.spawns).toHaveLength(MAX_PLAYERS);
    const indices = new Set<number>();
    for (const s of maze.spawns) {
      expect(Number.isInteger(s.x) && Number.isInteger(s.y)).toBe(true);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(maze.width);
      expect(s.y).toBeLessThan(maze.height);
      indices.add(cellIndex(maze.width, s.x, s.y));
    }
    expect(indices.size).toBe(MAX_PLAYERS);
    // Greedy farthest-point spread: every pair at least a few tiles apart.
    for (let i = 0; i < maze.spawns.length; i++) {
      for (let j = i + 1; j < maze.spawns.length; j++) {
        const a = maze.spawns[i]!;
        const b = maze.spawns[j]!;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        expect(d).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("exit is in bounds, on no spawn, and far from the spawn centroid", () => {
    const maze = generateMaze({ seed: "exit", size: "medium" });
    expect(maze.exit.x).toBeGreaterThanOrEqual(0);
    expect(maze.exit.y).toBeGreaterThanOrEqual(0);
    expect(maze.exit.x).toBeLessThan(maze.width);
    expect(maze.exit.y).toBeLessThan(maze.height);
    for (const s of maze.spawns) {
      expect(s.x === maze.exit.x && s.y === maze.exit.y).toBe(false);
    }
    let cx = 0;
    let cy = 0;
    for (const s of maze.spawns) {
      cx += s.x / maze.spawns.length;
      cy += s.y / maze.spawns.length;
    }
    const d = Math.hypot(maze.exit.x - cx, maze.exit.y - cy);
    expect(d).toBeGreaterThan(Math.min(maze.width, maze.height) / 4);
  });
});
