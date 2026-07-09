/**
 * Sound is vision: every sound event becomes a visualized ripple whose accuracy
 * is confidence-banded. Sound must never act as a wallhack — perceived position
 * is deliberately imprecise at lower confidence.
 */
export type SoundKind =
  | "footstep-sneak"
  | "footstep-walk"
  | "footstep-sprint"
  | "door"
  | "scream"
  | "explosion";

export type SoundConfidence = "low" | "medium" | "high";

/** A sound as emitted inside the simulation (exact, server-side only). */
export interface RawSoundEvent {
  kind: SoundKind;
  x: number;
  y: number;
  /** Base intensity 0..1 (sneak ~0.15, walk ~0.4, sprint ~0.8, explosion 1). */
  intensity: number;
  /** Entity id of the emitter, for deterministic perception jitter. */
  emitterId: number;
  tick: number;
}

/** A sound as perceived by one listener (what gets sent to that client). */
export interface PerceivedSound {
  kind: SoundKind;
  /** Perceived origin — jittered by confidence; never the exact position at low/medium. */
  x: number;
  y: number;
  confidence: SoundConfidence;
  /** Remaining intensity after distance + wall attenuation, 0..1. */
  intensity: number;
  tick: number;
}

/** Base emission intensity per sound kind. */
export const SOUND_INTENSITY: Record<SoundKind, number> = {
  "footstep-sneak": 0.15,
  "footstep-walk": 0.4,
  "footstep-sprint": 0.8,
  door: 0.5,
  scream: 0.9,
  explosion: 1.0,
};
