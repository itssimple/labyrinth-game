import {
  VISION_CONE_HALF_RAD,
  VISION_PERIPHERAL_RADIUS,
  VISION_RADIUS,
  cellIndex,
  inBounds,
  type Maze,
} from "@echowake/common";
import { distSq, gridLine } from "@echowake/math";
import { wallBetween } from "./walls.js";

/**
 * Line of sight between two cells: walk the Bresenham line and fail on the
 * first wall crossing. A diagonal step passes only if at least one of its two
 * L-shaped detours (horizontal-then-vertical or vertical-then-horizontal) is
 * fully open — corners of walls block sight. Also used by melee attacks
 * (no hitting through walls).
 */
export function hasLineOfSight(maze: Maze, x0: number, y0: number, x1: number, y1: number): boolean {
  const pts = gridLine(x0, y0, x1, y1);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) return false;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx !== 0 && dy !== 0) {
      const viaH =
        !wallBetween(maze, a.x, a.y, b.x, a.y) && !wallBetween(maze, b.x, a.y, b.x, b.y);
      const viaV =
        !wallBetween(maze, a.x, a.y, a.x, b.y) && !wallBetween(maze, a.x, b.y, b.x, b.y);
      if (!viaH && !viaV) return false;
    } else if (wallBetween(maze, a.x, a.y, b.x, b.y)) {
      return false;
    }
  }
  return true;
}

/**
 * Cell indices (row-major) visible from position (x, y) — tile units —
 * within VISION_RADIUS. Distance is measured from (x, y) to each cell's
 * center; line of sight runs cell-to-cell via gridLine and stops at the
 * first wall crossing, so walls fully block vision.
 *
 * `facing` (optional unit-ish vector — it is normalized defensively) makes
 * vision directional: a cell passes only if walls permit LOS (unchanged) AND
 * the direction from (x, y) to the cell's CENTER lies within
 * VISION_CONE_HALF_RAD of `facing` OR the center is within
 * VISION_PERIPHERAL_RADIUS (you are never fully blind behind you). The
 * standing cell is always visible. Omitted (or zero/non-finite) facing keeps
 * the legacy 360° behavior, so every pre-cone caller stays valid. The angle
 * test compares dot products against cos(half) — no atan2, no wraparound.
 */
export function computeVisibleCells(
  maze: Maze,
  x: number,
  y: number,
  facing?: { x: number; y: number },
): Set<number> {
  const visible = new Set<number>();
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (!inBounds(maze, px, py)) return visible;

  // Normalize the facing; degenerate input (zero/non-finite) => 360° vision.
  let fx = 0;
  let fy = 0;
  let cone = false;
  if (facing) {
    const flen = Math.sqrt(facing.x * facing.x + facing.y * facing.y);
    if (Number.isFinite(flen) && flen > 0) {
      fx = facing.x / flen;
      fy = facing.y / flen;
      cone = true;
    }
  }
  const cosHalf = Math.cos(VISION_CONE_HALF_RAD);
  const peripheral2 = VISION_PERIPHERAL_RADIUS * VISION_PERIPHERAL_RADIUS;

  const r = VISION_RADIUS;
  const r2 = r * r;
  const minY = Math.max(0, py - r);
  const maxY = Math.min(maze.height - 1, py + r);
  const minX = Math.max(0, px - r);
  const maxX = Math.min(maze.width - 1, px + r);
  for (let cy = minY; cy <= maxY; cy++) {
    for (let cx = minX; cx <= maxX; cx++) {
      const d2 = distSq(cx + 0.5, cy + 0.5, x, y);
      if (d2 > r2) continue;
      if (cone && !(cx === px && cy === py) && d2 > peripheral2) {
        // Cone test on the direction to the cell CENTER: inside iff
        // dot(facing, dir) >= cos(half) * |dir| — robust at every angle,
        // including straight behind (no atan2 wraparound).
        const dot = fx * (cx + 0.5 - x) + fy * (cy + 0.5 - y);
        if (dot < cosHalf * Math.sqrt(d2)) continue;
      }
      if (hasLineOfSight(maze, px, py, cx, cy)) {
        visible.add(cellIndex(maze.width, cx, cy));
      }
    }
  }
  return visible;
}
