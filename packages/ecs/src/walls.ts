import {
  WALL_E,
  WALL_N,
  WALL_S,
  WALL_W,
  cellIndex,
  inBounds,
  type Maze,
} from "@echowake/common";

/**
 * Whether a wall separates cell (x, y) from the 4-adjacent cell (nx, ny).
 * Out-of-bounds cells and non-adjacent pairs count as walled. Relies on the
 * mazegen wall-consistency invariant (both sides always agree), so only the
 * from-cell's bitmask is consulted.
 */
export function wallBetween(maze: Maze, x: number, y: number, nx: number, ny: number): boolean {
  if (!inBounds(maze, x, y) || !inBounds(maze, nx, ny)) return true;
  const cell = maze.cells[cellIndex(maze.width, x, y)];
  if (!cell) return true;
  const dx = nx - x;
  const dy = ny - y;
  if (dx === 1 && dy === 0) return (cell.walls & WALL_E) !== 0;
  if (dx === -1 && dy === 0) return (cell.walls & WALL_W) !== 0;
  if (dx === 0 && dy === 1) return (cell.walls & WALL_S) !== 0;
  if (dx === 0 && dy === -1) return (cell.walls & WALL_N) !== 0;
  return true;
}
