import { describe, expect, it } from "vitest";
import { PING_ALPHA, smoothPing } from "./ping";

describe("smoothPing", () => {
  it("adopts the first sample as-is", () => {
    expect(smoothPing(null, 42)).toBe(42);
  });

  it("moves toward new samples by alpha", () => {
    expect(smoothPing(100, 200)).toBeCloseTo(100 + PING_ALPHA * 100, 10);
    expect(smoothPing(100, 0)).toBeCloseTo(100 - PING_ALPHA * 100, 10);
  });

  it("converges toward a steady sample", () => {
    let est: number | null = 300;
    for (let i = 0; i < 50; i++) est = smoothPing(est, 20);
    expect(est).toBeCloseTo(20, 3);
  });

  it("ignores negative and non-finite samples", () => {
    expect(smoothPing(80, -5)).toBe(80);
    expect(smoothPing(80, Number.NaN)).toBe(80);
    expect(smoothPing(80, Number.POSITIVE_INFINITY)).toBe(80);
    expect(smoothPing(null, -1)).toBeNull();
  });
});
