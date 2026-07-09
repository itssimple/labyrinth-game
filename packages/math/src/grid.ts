/** A cell coordinate on the integer grid. */
export interface GridPoint {
  x: number;
  y: number;
}

/**
 * Bresenham line from (x0, y0) toward (x1, y1), assuming integer inputs
 * already in canonical order. Endpoints inclusive.
 */
function bresenham(x0: number, y0: number, x1: number, y1: number): GridPoint[] {
  const points: GridPoint[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    points.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
}

/**
 * Integer grid cells on the line from (x0, y0) to (x1, y1), inclusive at
 * both endpoints (Bresenham).
 *
 * Symmetric: `gridLine(a, b)` visits exactly the reverse of
 * `gridLine(b, a)` — the walk is always computed in a canonical endpoint
 * order, so line-of-sight checks agree in both directions.
 *
 * Coordinates are rounded to the nearest integer before tracing.
 */
export function gridLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): GridPoint[] {
  const ax = Math.round(x0);
  const ay = Math.round(y0);
  const bx = Math.round(x1);
  const by = Math.round(y1);
  // Canonical order (lexicographic) so tie-breaking is direction-independent.
  if (ax < bx || (ax === bx && ay <= by)) {
    return bresenham(ax, ay, bx, by);
  }
  return bresenham(bx, by, ax, ay).reverse();
}
