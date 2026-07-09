import { describe, expect, it } from "vitest";
import { botName } from "../src/index.js";

describe("botName", () => {
  it("is deterministic for the same index", () => {
    for (let i = 0; i < 40; i++) {
      expect(botName(i)).toBe(botName(i));
    }
  });

  it("gives every lobby slot a distinct friendly name", () => {
    const names = Array.from({ length: 16 }, (_, i) => botName(i));
    expect(new Set(names).size).toBe(16);
    for (const name of names) {
      expect(name).toMatch(/^Bot [A-Z][a-z]+$/);
    }
  });

  it("stays unique past the base name list by suffixing", () => {
    const names = Array.from({ length: 60 }, (_, i) => botName(i));
    expect(new Set(names).size).toBe(60);
  });
});
