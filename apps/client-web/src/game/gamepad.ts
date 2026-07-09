/**
 * Thin Gamepad API glue: one poll per input sample (the Gamepad API is
 * poll-based by design — no events for stick motion). All math lives in
 * aim.ts; this file only extracts axes from the first connected pad.
 *
 * Standard mapping: axes[0]/axes[1] = left stick (move),
 * axes[2]/axes[3] = right stick (aim).
 */

import { readStick, type StickRead } from "./aim";

export interface GamepadSticks {
  /** Left stick past the deadzone, or null (centered / not deflected). */
  move: StickRead | null;
  /** Right stick past the deadzone, or null. */
  aim: StickRead | null;
}

/** Polls the first connected gamepad; null when none (or API unavailable). */
export function pollGamepad(): GamepadSticks | null {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return null;
  for (const pad of navigator.getGamepads()) {
    if (pad === null || !pad.connected) continue;
    return {
      move: readStick(pad.axes[0] ?? 0, pad.axes[1] ?? 0),
      aim: readStick(pad.axes[2] ?? 0, pad.axes[3] ?? 0),
    };
  }
  return null;
}
