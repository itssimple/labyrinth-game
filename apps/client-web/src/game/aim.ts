/**
 * Pure aim/stick math for client input (mouse, gamepad, touch sticks).
 * No DOM, no Gamepad API — the thin glue lives in gamepad.ts / touch.ts /
 * session.ts. Everything here is presentation/input shaping only; the server
 * normalizes and validates aim again (authoritative, see docs/CONTRACTS.md
 * "Directional vision (view cones) & fog rendering").
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** A stick read past the deadzone: unit direction + rescaled magnitude. */
export interface StickRead {
  /** Unit direction. */
  x: number;
  y: number;
  /** Deflection in (0, 1]: 0 at the deadzone edge, 1 fully pushed. */
  magnitude: number;
}

/** Analog stick deadzone (contract: ~0.2). */
export const STICK_DEADZONE = 0.2;
/** Touch move stick must be pushed past this deflection to walk (v1). */
export const TOUCH_WALK_THRESHOLD = 0.5;
/** Pointer this close (px) to the player gives no usable direction. */
export const MIN_POINTER_DIST_PX = 4;
/**
 * Component threshold for discretizing a unit direction to 8-way movement.
 * 0.4 splits the circle into even-ish 8 sectors (sin 22.5° ≈ 0.38).
 */
const MOVE_AXIS_THRESHOLD = 0.4;

/**
 * Applies a radial deadzone and normalizes. Returns null while the stick is
 * inside the deadzone; otherwise the unit direction plus the deflection
 * rescaled so the deadzone edge is 0 and full push is 1 (clamped — physical
 * sticks can report slightly past the unit circle on diagonals).
 */
export function readStick(x: number, y: number, deadzone = STICK_DEADZONE): StickRead | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const mag = Math.hypot(x, y);
  if (mag <= deadzone) return null;
  const rescaled = Math.min(1, (mag - deadzone) / (1 - deadzone));
  return { x: x / mag, y: y / mag, magnitude: rescaled };
}

/** Discretizes a direction to the protocol's 8-way moveX/moveY (-1 | 0 | 1). */
export function directionToMove(x: number, y: number): { moveX: -1 | 0 | 1; moveY: -1 | 0 | 1 } {
  const mag = Math.hypot(x, y);
  if (mag === 0 || !Number.isFinite(mag)) return { moveX: 0, moveY: 0 };
  const nx = x / mag;
  const ny = y / mag;
  return {
    moveX: nx > MOVE_AXIS_THRESHOLD ? 1 : nx < -MOVE_AXIS_THRESHOLD ? -1 : 0,
    moveY: ny > MOVE_AXIS_THRESHOLD ? 1 : ny < -MOVE_AXIS_THRESHOLD ? -1 : 0,
  };
}

/**
 * Movement intent from the touch move stick. Deflection must exceed
 * TOUCH_WALK_THRESHOLD to walk; below that the stick is treated as idle.
 * TODO(touch v2): sprint/sneak for touch — v1 is walk-only by design.
 */
export function touchStickToMove(
  stick: StickRead | null,
): { moveX: -1 | 0 | 1; moveY: -1 | 0 | 1 } {
  if (stick === null || stick.magnitude <= TOUCH_WALK_THRESHOLD) return { moveX: 0, moveY: 0 };
  return directionToMove(stick.x, stick.y);
}

/**
 * Unit aim vector from the player's on-screen position toward the pointer,
 * or null when the pointer is too close to the player to define a direction
 * (also swallows the degenerate zero-distance case).
 */
export function pointerToAim(
  pointerX: number,
  pointerY: number,
  playerScreenX: number,
  playerScreenY: number,
): Vec2 | null {
  const dx = pointerX - playerScreenX;
  const dy = pointerY - playerScreenY;
  const dist = Math.hypot(dx, dy);
  if (!Number.isFinite(dist) || dist < MIN_POINTER_DIST_PX) return null;
  return { x: dx / dist, y: dy / dist };
}

/**
 * Per-frame aim source priority (contract): gamepad right stick, then the
 * touch aim stick, then the mouse. Null when no source produced a direction
 * this frame — the caller keeps the previous aim (or omits aim entirely so
 * facing follows movement server-side).
 */
export function pickAim(gamepad: Vec2 | null, touch: Vec2 | null, mouse: Vec2 | null): Vec2 | null {
  return gamepad ?? touch ?? mouse;
}
