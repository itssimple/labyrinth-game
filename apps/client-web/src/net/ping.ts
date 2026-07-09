/** Smoothing factor for RTT (exponential moving average). */
export const PING_ALPHA = 0.3;

/** How often the client sends a latency probe. */
export const PING_INTERVAL_MS = 2000;

/**
 * Folds one RTT sample into the smoothed ping estimate (EMA, alpha 0.3).
 * The first sample becomes the estimate as-is. Negative or non-finite
 * samples (clock weirdness, forged pong `t`) are ignored — the previous
 * estimate is returned unchanged.
 */
export function smoothPing(prev: number | null, sampleMs: number): number | null {
  if (!Number.isFinite(sampleMs) || sampleMs < 0) return prev;
  if (prev === null) return sampleMs;
  return prev + PING_ALPHA * (sampleMs - prev);
}
