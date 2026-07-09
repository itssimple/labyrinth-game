/**
 * Clamp `v` to the inclusive range [min, max].
 */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Squared Euclidean distance between (x0, y0) and (x1, y1).
 * Avoids the sqrt when only comparing distances.
 */
export function distSq(x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  return dx * dx + dy * dy;
}
