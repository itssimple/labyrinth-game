import { describe, expect, it } from "vitest";
import { FOG_RECENT_AFTER_S, FOG_STALE_AFTER_S, FogState } from "@labyrinth/common";
import { FogMemory } from "./fog";

describe("FogMemory", () => {
  it("starts fully unknown", () => {
    const fog = new FogMemory(9);
    for (let i = 0; i < 9; i++) expect(fog.stateAt(i, 0)).toBe(FogState.Unknown);
    expect(fog.everSeen(4)).toBe(false);
  });

  it("marks updated cells visible and leaves the rest unknown", () => {
    const fog = new FogMemory(9);
    fog.update([4, 5], 0);
    expect(fog.stateAt(4, 0)).toBe(FogState.Visible);
    expect(fog.stateAt(5, 0)).toBe(FogState.Visible);
    expect(fog.stateAt(0, 0)).toBe(FogState.Unknown);
    expect(fog.everSeen(4)).toBe(true);
  });

  it("ages Visible -> Recent -> Stale after leaving sight", () => {
    const fog = new FogMemory(9);
    fog.update([4], 0);
    fog.update([], 1); // cell 4 leaves sight; last seen at t=0

    // Still rendered Visible until FOG_RECENT_AFTER_S has elapsed.
    expect(fog.stateAt(4, FOG_RECENT_AFTER_S - 0.01)).toBe(FogState.Visible);
    expect(fog.stateAt(4, FOG_RECENT_AFTER_S)).toBe(FogState.Recent);
    expect(fog.stateAt(4, FOG_STALE_AFTER_S - 0.01)).toBe(FogState.Recent);
    expect(fog.stateAt(4, FOG_STALE_AFTER_S)).toBe(FogState.Stale);
    expect(fog.stateAt(4, FOG_STALE_AFTER_S + 1000)).toBe(FogState.Stale);
  });

  it("refreshes to Visible when re-seen", () => {
    const fog = new FogMemory(9);
    fog.update([4], 0);
    fog.update([], 1);
    expect(fog.stateAt(4, FOG_STALE_AFTER_S + 5)).toBe(FogState.Stale);
    fog.update([4], FOG_STALE_AFTER_S + 6);
    expect(fog.stateAt(4, FOG_STALE_AFTER_S + 6)).toBe(FogState.Visible);
  });

  it("keeps a cell Visible while it stays in every update", () => {
    const fog = new FogMemory(4);
    fog.update([2], 0);
    fog.update([2], 100);
    expect(fog.stateAt(2, 100)).toBe(FogState.Visible);
    // Cell 2's last-seen was refreshed at t=100, so at t=105 it is still fresh.
    fog.update([], 101);
    expect(fog.stateAt(2, 105)).toBe(FogState.Visible);
  });

  it("ignores out-of-range and non-integer indices", () => {
    const fog = new FogMemory(4);
    fog.update([-1, 4, 2.5, 99, 1], 0);
    expect(fog.stateAt(1, 0)).toBe(FogState.Visible);
    expect(fog.stateAt(-1, 0)).toBe(FogState.Unknown);
    expect(fog.stateAt(99, 0)).toBe(FogState.Unknown);
  });
});
