import type { SoundKind } from "@echowake/common";

/**
 * Pure Web Audio synthesis — ZERO external assets. Every SoundKind is built
 * from oscillators and filtered noise at call time. Functions here only take
 * an existing context + destination node; creating/resuming the context (and
 * the no-op guard for environments without Web Audio) lives in engine.ts.
 *
 * Math.random() is fine here: this is presentation-only timbre variation,
 * never simulation state.
 */

/** One second of cached white noise per context (footsteps, explosion). */
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (buf === undefined) {
    const len = Math.max(1, Math.floor(ctx.sampleRate));
    buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

/** Percussive gain envelope: fast attack to `peak`, exponential decay to ~0. */
function envelope(
  ctx: BaseAudioContext,
  dest: AudioNode,
  t0: number,
  peak: number,
  attackS: number,
  decayS: number,
): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + attackS);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attackS + decayS);
  g.connect(dest);
  return g;
}

interface BurstOpts {
  centerHz: number;
  q: number;
  peak: number;
  attackS: number;
  decayS: number;
  filterType?: BiquadFilterType;
}

/** Filtered white-noise burst — the basis of footsteps and the explosion. */
function noiseBurst(ctx: BaseAudioContext, dest: AudioNode, opts: BurstOpts): void {
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = opts.filterType ?? "bandpass";
  filter.frequency.value = opts.centerHz;
  filter.Q.value = opts.q;
  const env = envelope(ctx, dest, t0, opts.peak, opts.attackS, opts.decayS);
  src.connect(filter);
  filter.connect(env);
  src.start(t0);
  src.stop(t0 + opts.attackS + opts.decayS + 0.05);
}

/** Footstep noise-burst parameters per movement mode. */
const FOOTSTEP_BURST: Record<"footstep-sneak" | "footstep-walk" | "footstep-sprint", BurstOpts> = {
  // Sneak: a soft, short, high scuff. Walk: a mid tap. Sprint: a heavy low thud.
  "footstep-sneak": { centerHz: 2400, q: 1.4, peak: 0.35, attackS: 0.004, decayS: 0.05 },
  "footstep-walk": { centerHz: 1300, q: 1.0, peak: 0.7, attackS: 0.005, decayS: 0.09 },
  "footstep-sprint": { centerHz: 800, q: 0.8, peak: 1.0, attackS: 0.005, decayS: 0.13 },
};

/** +-10% pitch variation so repeated steps don't sound machine-gunned. */
function jitterHz(hz: number): number {
  return hz * (0.9 + Math.random() * 0.2);
}

function playFootstep(ctx: BaseAudioContext, dest: AudioNode, kind: keyof typeof FOOTSTEP_BURST): void {
  const base = FOOTSTEP_BURST[kind];
  noiseBurst(ctx, dest, { ...base, centerHz: jitterHz(base.centerHz) });
}

/** Door thunk: a low pitch-dropping triangle plus a short latch click. */
function playDoor(ctx: BaseAudioContext, dest: AudioNode): void {
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(140, t0);
  osc.frequency.exponentialRampToValueAtTime(55, t0 + 0.12);
  osc.connect(envelope(ctx, dest, t0, 0.9, 0.006, 0.22));
  osc.start(t0);
  osc.stop(t0 + 0.3);
  noiseBurst(ctx, dest, { centerHz: 500, q: 1.5, peak: 0.3, attackS: 0.002, decayS: 0.04 });
}

/** Scream: a bandpassed sawtooth that wails up then falls off. */
function playScream(ctx: BaseAudioContext, dest: AudioNode): void {
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(jitterHz(650), t0);
  osc.frequency.exponentialRampToValueAtTime(950, t0 + 0.12);
  osc.frequency.exponentialRampToValueAtTime(480, t0 + 0.55);
  const throat = ctx.createBiquadFilter();
  throat.type = "bandpass";
  throat.frequency.value = 900;
  throat.Q.value = 1.8;
  osc.connect(throat);
  throat.connect(envelope(ctx, dest, t0, 0.6, 0.03, 0.55));
  osc.start(t0);
  osc.stop(t0 + 0.65);
}

/** Explosion: a long lowpassed noise rumble over a decaying sub-sine. */
function playExplosion(ctx: BaseAudioContext, dest: AudioNode): void {
  const t0 = ctx.currentTime;
  noiseBurst(ctx, dest, {
    centerHz: 220,
    q: 0.5,
    peak: 1.0,
    attackS: 0.01,
    decayS: 1.3,
    filterType: "lowpass",
  });
  const sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.setValueAtTime(50, t0);
  sub.frequency.exponentialRampToValueAtTime(28, t0 + 0.9);
  sub.connect(envelope(ctx, dest, t0, 0.8, 0.01, 0.9));
  sub.start(t0);
  sub.stop(t0 + 1.0);
}

/** Synthesizes one SoundKind into `dest` (routing/pan/volume is the caller's). */
export function playKind(ctx: BaseAudioContext, dest: AudioNode, kind: SoundKind): void {
  switch (kind) {
    case "footstep-sneak":
    case "footstep-walk":
    case "footstep-sprint":
      playFootstep(ctx, dest, kind);
      break;
    case "door":
      playDoor(ctx, dest);
      break;
    case "scream":
      playScream(ctx, dest);
      break;
    case "explosion":
      playExplosion(ctx, dest);
      break;
  }
}
