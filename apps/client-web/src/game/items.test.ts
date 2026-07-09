import { describe, expect, it } from "vitest";
import { ItemMemory, itemColor, itemColorCss, itemInitial, itemName } from "./items";
import { ITEM_FALLBACK_COLOR, ITEM_KIND_COLOR } from "./palette";

// 4x4 maze, row-major: cell = y * 4 + x.
const W = 4;
const sword = (x: number, y: number) => ({ id: 1, item: "rusty-sword", x, y });
const bandage = (x: number, y: number) => ({ id: 2, item: "bandage", x, y });

describe("ItemMemory", () => {
  it("starts empty", () => {
    expect(new ItemMemory(W).list()).toEqual([]);
  });

  it("lists currently-visible items live (not ghosts)", () => {
    const mem = new ItemMemory(W);
    mem.update([sword(1.5, 2.5)], [9]); // cell (1,2) = 9
    expect(mem.list()).toEqual([{ id: 1, item: "rusty-sword", x: 1.5, y: 2.5, ghost: false }]);
  });

  it("keeps an out-of-sight item as a ghost at its last-seen position", () => {
    const mem = new ItemMemory(W);
    mem.update([sword(1.5, 2.5)], [9]);
    mem.update([], [0, 1]); // looking elsewhere; cell 9 not visible
    expect(mem.list()).toEqual([{ id: 1, item: "rusty-sword", x: 1.5, y: 2.5, ghost: true }]);
  });

  it("forgets a ghost once its cell is seen again without the item", () => {
    const mem = new ItemMemory(W);
    mem.update([sword(1.5, 2.5)], [9]);
    mem.update([], [0, 1]); // ghost survives out of sight
    mem.update([], [9]); // cell back in sight, item gone => forget
    expect(mem.list()).toEqual([]);
  });

  it("forgets immediately when the item vanishes while its cell stays visible", () => {
    const mem = new ItemMemory(W);
    mem.update([sword(1.5, 2.5)], [9]);
    mem.update([], [9]); // picked up in front of you
    expect(mem.list()).toEqual([]);
  });

  it("keeps ghosts whose cells are NOT among the re-seen cells", () => {
    const mem = new ItemMemory(W);
    mem.update([sword(1.5, 2.5), bandage(0.5, 0.5)], [9, 0]);
    mem.update([], [0]); // only the bandage's cell re-seen empty
    expect(mem.list()).toEqual([{ id: 1, item: "rusty-sword", x: 1.5, y: 2.5, ghost: true }]);
  });

  it("refreshes a re-seen item back to live and tracks its new position", () => {
    const mem = new ItemMemory(W);
    mem.update([sword(1.5, 2.5)], [9]);
    mem.update([], [0]);
    mem.update([sword(3.5, 3.5)], [15]); // dropped elsewhere, same instance id
    expect(mem.list()).toEqual([{ id: 1, item: "rusty-sword", x: 3.5, y: 3.5, ghost: false }]);
  });
});

describe("item display helpers", () => {
  it("resolves names and initials from @echowake/content defs", () => {
    expect(itemName("rusty-sword")).toBe("Rusty Sword");
    expect(itemInitial("rusty-sword")).toBe("R");
    expect(itemInitial("bandage")).toBe("B");
  });

  it("falls back to the raw id for unknown (modded) items", () => {
    expect(itemName("mystery-orb")).toBe("mystery-orb");
    expect(itemInitial("mystery-orb")).toBe("M");
    expect(itemColor("mystery-orb")).toBe(ITEM_FALLBACK_COLOR);
  });

  it("colors by item kind", () => {
    expect(itemColor("rusty-sword")).toBe(ITEM_KIND_COLOR.weapon);
    expect(itemColor("bandage")).toBe(ITEM_KIND_COLOR.consumable);
    expect(itemColorCss("bandage")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
