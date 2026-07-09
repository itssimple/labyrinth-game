import { VISION_RADIUS, cellIndex, inBounds, type Maze } from "@echowake/common";
import { distSq, gridLine } from "@echowake/math";
import { wallBetween } from "./walls.js";

/**
 * Line of sight between two cells: walk the Bresenham line and fail on the
 * first wall crossing. A diagonal step passes only if at least one of its two
 * L-shaped detours (horizontal-then-vertical or vertical-then-horizontal) is
 * fully open — corners of walls block sight.
 */
function hasLineOfSight(maze: Maze, x0: number, y0: number, x1: number, y1: number): boolean {
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
 */
export function computeVisibleCells(maze: Maze, x: number, y: number): Set<number> {
  const visible = new Set<number>();
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (!inBounds(maze, px, py)) return visible;
  const r = VISION_RADIUS;
  const r2 = r * r;
  const minY = Math.max(0, py - r);
  const maxY = Math.min(maze.height - 1, py + r);
  const minX = Math.max(0, px - r);
  const maxX = Math.min(maze.width - 1, px + r);
  for (let cy = minY; cy <= maxY; cy++) {
    for (let cx = minX; cx <= maxX; cx++) {
      if (distSq(cx + 0.5, cy + 0.5, x, y) > r2) continue;
      if (hasLineOfSight(maze, px, py, cx, cy)) {
        visible.add(cellIndex(maze.width, cx, cy));
      }
    }
  }
  return visible;
}
