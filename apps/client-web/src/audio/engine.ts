import { SOUND_INTENSITY, type PerceivedSound } from "@echowake/common";
import { confidenceLowpassHz, perceivedGain, stereoPan, type MoveMode } from "./spatial";
import { playKind } from "./synth";

export const VOLUME_STORAGE_KEY = "echowake.volume";
export const MUTED_STORAGE_KEY = "echowake.muted";
const DEFAULT_VOLUME = 0.7;

/** Your own steps are under your feet — present, but well below others'. */
const OWN_FOOTSTEP_SCALE = 0.35;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** localStorage is absent/blocked in some environments — treat it as best-effort. */
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Settings simply won't persist.
  }
}

/**
 * Client audio ("Sound is gameplay", README) — presentation only, nothing
 * gameplay-affecting lives here. Owns the AudioContext and the master
 * GainNode; all sounds are synthesized (synth.ts), zero assets.
 *
 * Browser autoplay policy: the AudioContext is created/resumed by `unlock()`,
 * which the session calls from the Host/Join click — NEVER at module load.
 * In environments without Web Audio (headless tests) every method no-ops.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private volumeState: number;
  private mutedState: boolean;

  constructor() {
    const rawVolume = readStorage(VOLUME_STORAGE_KEY);
    const parsed = rawVolume === null ? NaN : Number(rawVolume);
    this.volumeState = Number.isFinite(parsed) ? clamp01(parsed) : DEFAULT_VOLUME;
    this.mutedState = readStorage(MUTED_STORAGE_KEY) === "true";
  }

  get volume(): number {
    return this.volumeState;
  }

  get muted(): boolean {
    return this.mutedState;
  }

  /**
   * Creates the AudioContext on first call and resumes it if suspended.
   * MUST be called from a user-gesture handler (autoplay policy); safe to
   * call repeatedly. No-op where Web Audio doesn't exist.
   */
  unlock(): void {
    if (this.ctx === null) {
      if (typeof AudioContext !== "function") return; // headless: null engine
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.masterGain();
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume().catch(() => {
        // Not a gesture after all — the next unlock() will retry.
      });
    }
  }

  setVolume(v: number): void {
    this.volumeState = clamp01(v);
    writeStorage(VOLUME_STORAGE_KEY, String(this.volumeState));
    this.applyMasterGain();
  }

  setMuted(m: boolean): void {
    this.mutedState = m;
    writeStorage(MUTED_STORAGE_KEY, String(m));
    this.applyMasterGain();
  }

  /**
   * Plays one server-perceived sound positionally: stereo pan from direction
   * relative to the listener, gain from remaining intensity, gentle lowpass
   * at low confidence. Uses ONLY data already in the snapshot — occlusion is
   * baked into intensity by the server and is never re-derived.
   */
  playPerceived(sound: PerceivedSound, listenerX: number, listenerY: number): void {
    this.play(
      sound.kind,
      perceivedGain(sound.intensity),
      stereoPan(sound.x - listenerX, sound.y - listenerY),
      confidenceLowpassHz(sound.confidence),
    );
  }

  /**
   * Your own footstep (the server never echoes your own sounds): centered,
   * quieter than the same step heard from someone else.
   */
  playOwnFootstep(mode: MoveMode): void {
    const kind = `footstep-${mode}` as const;
    this.play(kind, perceivedGain(SOUND_INTENSITY[kind]) * OWN_FOOTSTEP_SCALE, 0, null);
  }

  /**
   * Your own melee swing, played locally on the attack keypress for
   * responsiveness (the server never echoes your own sounds back). Centered
   * and scaled down like your own footsteps. Presentation only — whether the
   * swing HITS remains entirely the server's call.
   */
  playOwnSwing(): void {
    this.play(
      "melee-swing",
      perceivedGain(SOUND_INTENSITY["melee-swing"]) * OWN_FOOTSTEP_SCALE,
      0,
      null,
    );
  }

  /** Builds the per-sound chain: synth -> gain -> [lowpass] -> [pan] -> master. */
  private play(
    kind: PerceivedSound["kind"],
    gain: number,
    pan: number,
    lowpassHz: number | null,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (ctx === null || master === null || this.mutedState || gain <= 0) return;
    const g = ctx.createGain();
    g.gain.value = gain;
    let tail: AudioNode = g;
    if (lowpassHz !== null) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = lowpassHz;
      tail.connect(lp);
      tail = lp;
    }
    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      tail.connect(panner);
      tail = panner;
    }
    tail.connect(master);
    playKind(ctx, g, kind);
  }

  /** Perceptual master curve — a linear slider feels front-loaded otherwise. */
  private masterGain(): number {
    return this.mutedState ? 0 : this.volumeState * this.volumeState;
  }

  private applyMasterGain(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (ctx === null || master === null) return;
    // Short ramp instead of a hard set: avoids clicks when sliding/muting.
    master.gain.setTargetAtTime(this.masterGain(), ctx.currentTime, 0.02);
  }
}
