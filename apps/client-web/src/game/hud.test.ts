import { describe, expect, it } from "vitest";
import { dropSlotIndex, hpDropped, pressSlot } from "./hud";

const INV = ["rusty-sword", null, "bandage", "noisemaker"] as const;

describe("pressSlot", () => {
  it("selects without using for non-consumables", () => {
    expect(pressSlot(INV, 0)).toEqual({ select: 0, use: false });
  });

  it("selects and uses for consumables", () => {
    expect(pressSlot(INV, 2)).toEqual({ select: 2, use: true });
    expect(pressSlot(INV, 3)).toEqual({ select: 3, use: true });
  });

  it("selects without using for empty slots", () => {
    expect(pressSlot(INV, 1)).toEqual({ select: 1, use: false });
  });

  it("never uses unknown (modded) item ids", () => {
    expect(pressSlot(["mystery-orb", null, null, null], 0)).toEqual({ select: 0, use: false });
  });
});

describe("dropSlotIndex", () => {
  it("drops the selected slot when occupied", () => {
    expect(dropSlotIndex(INV, 2)).toBe(2);
  });

  it("falls back to the first occupied slot when the selected one is empty", () => {
    expect(dropSlotIndex(INV, 1)).toBe(0);
    expect(dropSlotIndex([null, null, "bandage", null], 0)).toBe(2);
  });

  it("returns null when the inventory is empty", () => {
    expect(dropSlotIndex([null, null, null, null], 1)).toBeNull();
  });
});

describe("hpDropped", () => {
  it("triggers only on a decrease from a known previous hp", () => {
    expect(hpDropped(100, 65)).toBe(true);
    expect(hpDropped(65, 65)).toBe(false);
    expect(hpDropped(65, 95)).toBe(false); // heal: no flash
    expect(hpDropped(null, 40)).toBe(false); // first snapshot: no baseline
  });
});
