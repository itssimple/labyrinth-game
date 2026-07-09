import { describe, expect, it } from "vitest";
import {
  FISTS,
  ITEM_DEFS,
  itemDef,
  validateItemDef,
  validateItemDefs,
  type ItemDef,
} from "../src/index.js";

describe("ITEM_DEFS (v1 set)", () => {
  it("contains the full v1 set with the contract stats", () => {
    expect(ITEM_DEFS.map((d) => d.id).sort()).toEqual(
      [
        "rusty-sword",
        "leather-armor",
        "iron-armor",
        "soft-boots",
        "warding-charm",
        "veil-charm",
        "bandage",
        "noisemaker",
      ].sort(),
    );
    expect(itemDef("rusty-sword")).toMatchObject({ kind: "weapon", damage: 35, cooldownS: 0.8 });
    expect(itemDef("leather-armor")).toMatchObject({
      kind: "armor",
      damageTakenMul: 0.7,
      footstepMul: 1.15,
    });
    expect(itemDef("iron-armor")).toMatchObject({
      kind: "armor",
      damageTakenMul: 0.4,
      footstepMul: 1.4,
    });
    expect(itemDef("soft-boots")).toMatchObject({ kind: "boots", footstepMul: 0.5 });
    expect(itemDef("warding-charm")).toMatchObject({
      kind: "charm",
      aura: { radius: 3, damageTakenMul: 0.75 },
    });
    expect(itemDef("veil-charm")).toMatchObject({
      kind: "charm",
      aura: { radius: 3, emittedSoundMul: 0.5 },
    });
    expect(itemDef("bandage")).toMatchObject({ kind: "consumable", healHp: 30 });
    expect(itemDef("noisemaker")).toMatchObject({
      kind: "consumable",
      noisemaker: { durationS: 10, intervalS: 0.5 },
    });
  });

  it("every v1 def (and FISTS) validates", () => {
    for (const def of ITEM_DEFS) expect(() => validateItemDef(def)).not.toThrow();
    expect(() => validateItemDef(FISTS)).not.toThrow();
    expect(() => validateItemDefs([...ITEM_DEFS, FISTS])).not.toThrow();
  });

  it("FISTS is the implicit default weapon and not in ITEM_DEFS", () => {
    expect(FISTS).toMatchObject({ id: "fists", kind: "weapon", damage: 10, cooldownS: 0.6 });
    expect(ITEM_DEFS.some((d) => d.id === "fists")).toBe(false);
    expect(itemDef("fists")).toBeUndefined();
  });
});

describe("itemDef", () => {
  it("looks up defs by id and returns undefined for unknown ids", () => {
    expect(itemDef("bandage")?.name).toBe("Bandage");
    expect(itemDef("no-such-item")).toBeUndefined();
    expect(itemDef("")).toBeUndefined();
  });
});

describe("validateItemDef", () => {
  const weapon = (over: Partial<ItemDef>): ItemDef => ({
    id: "test-weapon",
    name: "Test Weapon",
    kind: "weapon",
    damage: 10,
    cooldownS: 1,
    ...over,
  });

  it("rejects unknown kinds", () => {
    expect(() =>
      validateItemDef({ id: "hat", name: "Hat", kind: "hat" as ItemDef["kind"] }),
    ).toThrow(/unknown kind/);
  });

  it("rejects malformed ids and names", () => {
    expect(() => validateItemDef(weapon({ id: "" }))).toThrow(/kebab-case/);
    expect(() => validateItemDef(weapon({ id: "Rusty Sword" }))).toThrow(/kebab-case/);
    expect(() => validateItemDef(weapon({ name: "" }))).toThrow(/name/);
  });

  it("rejects out-of-range or non-finite multipliers", () => {
    const armor: ItemDef = { id: "a", name: "A", kind: "armor", damageTakenMul: 0.5 };
    expect(() => validateItemDef({ ...armor, damageTakenMul: -1 })).toThrow(/damageTakenMul/);
    expect(() => validateItemDef({ ...armor, damageTakenMul: 100 })).toThrow(/damageTakenMul/);
    expect(() => validateItemDef({ ...armor, damageTakenMul: Number.NaN })).toThrow(
      /damageTakenMul/,
    );
    expect(() => validateItemDef({ ...armor, footstepMul: Number.POSITIVE_INFINITY })).toThrow(
      /footstepMul/,
    );
    expect(() => validateItemDef(weapon({ spawnWeight: -2 }))).toThrow(/spawnWeight/);
  });

  it("rejects missing required fields per kind", () => {
    expect(() => validateItemDef(weapon({ damage: undefined }))).toThrow(/damage/);
    expect(() => validateItemDef(weapon({ cooldownS: 0 }))).toThrow(/cooldownS/);
    expect(() => validateItemDef({ id: "a", name: "A", kind: "armor" })).toThrow(
      /damageTakenMul/,
    );
    expect(() => validateItemDef({ id: "b", name: "B", kind: "boots" })).toThrow(/footstepMul/);
    expect(() => validateItemDef({ id: "c", name: "C", kind: "charm" })).toThrow(/aura/);
    expect(() =>
      validateItemDef({ id: "c", name: "C", kind: "charm", aura: { radius: 3 } }),
    ).toThrow(/aura/);
    expect(() =>
      validateItemDef({ id: "c", name: "C", kind: "charm", aura: { radius: 0, damageTakenMul: 1 } }),
    ).toThrow(/radius/);
    expect(() => validateItemDef({ id: "d", name: "D", kind: "consumable" })).toThrow(
      /exactly one/,
    );
    expect(() =>
      validateItemDef({
        id: "d",
        name: "D",
        kind: "consumable",
        healHp: 5,
        noisemaker: { durationS: 1, intervalS: 1 },
      }),
    ).toThrow(/exactly one/);
    expect(() =>
      validateItemDef({
        id: "n",
        name: "N",
        kind: "consumable",
        noisemaker: { durationS: 1, intervalS: 2 },
      }),
    ).toThrow(/intervalS/);
  });
});

describe("validateItemDefs", () => {
  it("rejects duplicate ids", () => {
    const def: ItemDef = { id: "dup", name: "Dup", kind: "boots", footstepMul: 0.5 };
    expect(() => validateItemDefs([def, { ...def }])).toThrow(/duplicate/);
  });
});
