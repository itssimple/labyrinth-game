import { MOVE_SPEED, type SoundConfidence } from "@echowake/common";

/**
 * Pure spatial-audio math, kept free of Web Audio (and of the DOM) so it is
 * unit-testable headless. The AudioEngine applies these numbers to real nodes.
 * Audio is presentation only — nothing here feeds back into gameplay.
 */

export type MoveMode = keyof typeof MOVE_SPEED; // "sneak" | "walk" | "sprint"

/**
 * Seconds of continuous movement between footsteps, per mode. MUST mirror
 * FOOTSTEP_INTERVAL_S in packages/ecs/src/tuning.ts (not exported from
 * @echowake/ecs) so what you hear of yourself matches what others see/hear.
 */
export const FOOTSTEP_INTERVAL_S: Record<MoveMode, number> = {
  sneak: 0.7,
  walk: 0.45,
  sprint: 0.3,
} as const;

/**
 * Tiles of actual movement between footsteps — the same distance-accumulator
 * interval the simulation uses (MOVE_SPEED * FOOTSTEP_INTERVAL_S).
 */
export function footstepIntervalTiles(mode: MoveMode): number {
  return MOVE_SPEED[mode] * FOOTSTEP_INTERVAL_S[mode];
}

/** Beyond this lateral distance (tiles) a sound is panned fully to one ear. */
const FULL_PAN_TILES = 4;

/**
 * Stereo pan in [-1, 1] for a sound at offset (dx, dy) from the listener,
 * in tiles (+x = east = right ear). Direction sets the side; very close
 * sounds stay near the center so a sound on top of you doesn't hard-flip
 * between ears.
 */
export function stereoPan(dx: number, dy: number): number {
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return 0;
  const pan = (dx / dist) * Math.min(1, dist / FULL_PAN_TILES);
  return pan < -1 ? -1 : pan > 1 ? 1 : pan;
}

/**
 * Playback gain in [0, 1] from a perceived intensity in [0, 1]. Square-root
 * curve: quiet sounds stay audible without loud ones clipping. Occlusion is
 * already baked into intensity by the server — never re-derive it here.
 */
export function perceivedGain(intensity: number): number {
  const i = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;
  return Math.sqrt(i);
}

/**
 * Lowpass cutoff (Hz) to muffle a sound by confidence, or null for no filter.
 * Low-confidence sounds are distant/occluded guesses — they should sound like
 * it.
 */
export function confidenceLowpassHz(confidence: SoundConfidence): number | null {
  return confidence === "low" ? 1000 : null;
}

/**
 * A per-snapshot movement delta above this is a teleport (spawn, tab
 * refocus after missed snapshots), not walking — at 20Hz even sprinting
 * covers only 0.25 tiles per snapshot.
 */
const TELEPORT_TILES = 1;

/**
 * Distance-moved footstep accumulator for the local player, mirroring the
 * simulation's per-player accumulator (packages/ecs simulation): one step per
 * `footstepIntervalTiles(mode)` of actual movement.
 */
export class FootstepCadence {
  private acc = 0;

  reset(): void {
    this.acc = 0;
  }

  /**
   * Feeds one snapshot-to-snapshot movement distance (tiles); returns how
   * many footsteps fire. NaN/zero/teleport deltas produce none.
   */
  advance(movedTiles: number, mode: MoveMode): number {
    if (!(movedTiles > 0)) return 0;
    if (movedTiles > TELEPORT_TILES) {
      this.acc = 0;
      return 0;
    }
    const interval = footstepIntervalTiles(mode);
    this.acc += movedTiles;
    let steps = 0;
    while (this.acc >= interval) {
      this.acc -= interval;
      steps++;
    }
    return steps;
  }
}
