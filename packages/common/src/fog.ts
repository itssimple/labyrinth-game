/**
 * Fog-of-war knowledge states for a cell, per player ("Knowledge Ages" pillar).
 * Client-side memory decays Visible -> Recent -> Stale over time; Unknown cells
 * have never been seen.
 */
export const FogState = {
  Unknown: 0,
  Stale: 1,
  Recent: 2,
  Visible: 3,
} as const;
export type FogStateId = (typeof FogState)[keyof typeof FogState];

/** Seconds after leaving sight before a cell fades Visible -> Recent -> Stale. */
export const FOG_RECENT_AFTER_S = 10;
export const FOG_STALE_AFTER_S = 60;
