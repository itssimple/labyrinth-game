import { clamp } from "@echowake/math";

export interface CompassPlacement {
  /** Screen-space position for the arrow, clamped to the margin box. */
  x: number;
  y: number;
  /** Radians; 0 points right (+x), suitable for Pixi `rotation`. */
  angle: number;
}

/**
 * Edge-of-screen compass placement for an off-screen target (pure, DOM-free).
 *
 * `targetX/targetY` is the target's screen-space position. Returns null while
 * the target is inside the viewport (no arrow needed). Otherwise the arrow
 * sits on an inset margin box, pointing from the screen center — the camera
 * keeps "you" centered, so center->target is exactly you->target — toward
 * the target.
 */
export function placeCompass(
  screenW: number,
  screenH: number,
  targetX: number,
  targetY: number,
  margin: number,
): CompassPlacement | null {
  if (targetX >= 0 && targetX <= screenW && targetY >= 0 && targetY <= screenH) return null;
  return {
    x: clamp(targetX, margin, screenW - margin),
    y: clamp(targetY, margin, screenH - margin),
    angle: Math.atan2(targetY - screenH / 2, targetX - screenW / 2),
  };
}
