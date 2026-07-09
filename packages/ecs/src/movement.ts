import {
  PLAYER_RADIUS,
  WALL_E,
  WALL_N,
  WALL_S,
  WALL_W,
  cellIndex,
  inBounds,
  type Maze,
} from "@echowake/common";
import { clamp } from "@echowake/math";

const EPS = 1e-9;

/**
 * Push a circle of radius `r` centered at (x, y) out of a unit-length
 * axis-aligned wall segment from (sx0, sy0) to (sx1, sy1). Returns the
 * corrected center, or null if not overlapping. Endpoint (corner) contacts
 * push diagonally, which is what makes corners feel round instead of sticky.
 */
function pushOut(
  x: number,
  y: number,
  sx0: number,
  sy0: number,
  sx1: number,
  sy1: number,
  r: number,
): { x: number; y: number } | null {
  const dx = sx1 - sx0;
  const dy = sy1 - sy0;
  const t = clamp(((x - sx0) * dx + (y - sy0) * dy) / (dx * dx + dy * dy), 0, 1);
  const px = sx0 + t * dx;
  const py = sy0 + t * dy;
  const ox = x - px;
  const oy = y - py;
  const d2 = ox * ox + oy * oy;
  if (d2 >= r * r) return null;
  const d = Math.sqrt(d2);
  if (d < EPS) {
    // Center exactly on the segment: push along a fixed segment normal.
    return { x: px + dy * r, y: py - dx * r };
  }
  const push = (r - d) / d;
  return { x: x + ox * push, y: y + oy * push };
}

/**
 * Resolve all wall overlaps for a circle (PLAYER_RADIUS) at (x, y) by pushing
 * it out of every wall segment in the surrounding 3×3 cell neighborhood.
 * A few relaxation iterations settle corner/corridor cases; finally the
 * position is clamped inside the maze bounds as a safety net (generated
 * mazes always have border walls, hand-crafted ones should too).
 */
function resolve(maze: Maze, x: number, y: number): { x: number; y: number } {
  const r = PLAYER_RADIUS;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        if (!inBounds(maze, gx, gy)) continue;
        const cell = maze.cells[cellIndex(maze.width, gx, gy)];
        if (!cell) continue;
        const w = cell.walls;
        let p: { x: number; y: number } | null;
        if (w & WALL_N && (p = pushOut(x, y, gx, gy, gx + 1, gy, r))) {
          ({ x, y } = p);
          moved = true;
        }
        if (w & WALL_S && (p = pushOut(x, y, gx, gy + 1, gx + 1, gy + 1, r))) {
          ({ x, y } = p);
          moved = true;
        }
        if (w & WALL_W && (p = pushOut(x, y, gx, gy, gx, gy + 1, r))) {
          ({ x, y } = p);
          moved = true;
        }
        if (w & WALL_E && (p = pushOut(x, y, gx + 1, gy, gx + 1, gy + 1, r))) {
          ({ x, y } = p);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return {
    x: clamp(x, r, maze.width - r),
    y: clamp(y, r, maze.height - r),
  };
}

/**
 * Move a player circle by (dx, dy) with wall collision and sliding.
 * Integrates the X axis, resolves, then the Y axis, resolves — the axis
 * split is what produces sliding along walls. Tunneling is impossible for
 * slice speeds: the per-tick step (MOVE_SPEED.sprint * TICK_DT = 0.25) is
 * smaller than PLAYER_RADIUS (0.35), so a resolved position can never jump
 * across a wall line in one sub-step. Pure float math — fully deterministic.
 */
export function moveCircle(
  maze: Maze,
  x: number,
  y: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  let p = resolve(maze, x + dx, y);
  p = resolve(maze, p.x, p.y + dy);
  return p;
}
