import { WALL_E, WALL_N, WALL_S, WALL_W, cellIndex, type Cell } from "@labyrinth/common";
import type { Rng } from "./rand.js";

/** The four cardinal directions with their wall bit and the neighbor's opposite bit. */
export const DIRECTIONS = [
  { dx: 0, dy: -1, wall: WALL_N, opposite: WALL_S },
  { dx: 1, dy: 0, wall: WALL_E, opposite: WALL_W },
  { dx: 0, dy: 1, wall: WALL_S, opposite: WALL_N },
  { dx: -1, dy: 0, wall: WALL_W, opposite: WALL_E },
] as const;

export type Direction = (typeof DIRECTIONS)[number];

/**
 * Remove the wall between (x, y) and its neighbor in `dir`, updating both
 * cells so neighbors always agree. The neighbor must be in bounds.
 */
export function removeWall(
  cells: Cell[],
  width: number,
  x: number,
  y: number,
  dir: Direction,
): void {
  const here = cells[cellIndex(width, x, y)];
  const there = cells[cellIndex(width, x + dir.dx, y + dir.dy)];
  if (!here || !there) throw new Error("removeWall: out of bounds");
  here.walls &= ~dir.wall;
  there.walls &= ~dir.opposite;
}

/**
 * Carve a perfect maze (every cell reachable, no loops) in-place using an
 * iterative recursive-backtracker. All cells must start with all four walls
 * set. Border walls are never touched (only in-bounds neighbor pairs carve).
 */
export function carvePerfectMaze(cells: Cell[], width: number, height: number, rng: Rng): void {
  const visited = new Uint8Array(width * height);
  const startX = rng.int(0, width);
  const startY = rng.int(0, height);
  const stack: { x: number; y: number }[] = [{ x: startX, y: startY }];
  visited[cellIndex(width, startX, startY)] = 1;

  while (stack.length > 0) {
    const current = stack[stack.length - 1] as { x: number; y: number };
    const options: Direction[] = [];
    for (const dir of DIRECTIONS) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (visited[cellIndex(width, nx, ny)]) continue;
      options.push(dir);
    }
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const dir = rng.pick(options);
    removeWall(cells, width, current.x, current.y, dir);
    const next = { x: current.x + dir.dx, y: current.y + dir.dy };
    visited[cellIndex(width, next.x, next.y)] = 1;
    stack.push(next);
  }
}

/**
 * Carve extra loops by removing roughly `(1 - difficulty) * 8%` of the
 * remaining interior walls (each shared wall counted once). Higher difficulty
 * removes fewer walls, keeping more dead ends.
 */
export function carveLoops(
  cells: Cell[],
  width: number,
  height: number,
  difficulty: number,
  rng: Rng,
): void {
  const candidates: { x: number; y: number; dir: Direction }[] = [];
  const east = DIRECTIONS[1];
  const south = DIRECTIONS[2];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[cellIndex(width, x, y)] as Cell;
      if (x < width - 1 && cell.walls & WALL_E) candidates.push({ x, y, dir: east });
      if (y < height - 1 && cell.walls & WALL_S) candidates.push({ x, y, dir: south });
    }
  }
  const fraction = (1 - difficulty) * 0.08;
  const removeCount = Math.round(candidates.length * fraction);
  const shuffled = rng.shuffle(candidates);
  for (let i = 0; i < removeCount; i++) {
    const wall = shuffled[i] as { x: number; y: number; dir: Direction };
    removeWall(cells, width, wall.x, wall.y, wall.dir);
  }
}
