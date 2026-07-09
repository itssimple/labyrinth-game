/**
 * Deterministic 32-bit FNV-1a hash of a string.
 *
 * Returns an unsigned 32-bit integer. Intended for sub-seeding RNG streams,
 * e.g. `hashString(`${seed}:${purpose}`)`. Never changes across versions —
 * generated content depends on it.
 */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
