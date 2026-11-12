import { describe, expect, test } from "bun:test";
import { emptyArrivals, isFresh, trackArrivals } from "../../src/web/arrivals.ts";

describe("arrivals", () => {
  test("failures already on screen at start do not pulse", () => {
    const a = trackArrivals(emptyArrivals(), ["x", "y"], 1_000);
    expect(isFresh(a, "x", 1_000)).toBe(false);
  });

  test("a failure that appears later pulses, then settles", () => {
    let a = trackArrivals(emptyArrivals(), ["x"], 0);
    a = trackArrivals(a, ["x", "y"], 60_000);
    expect(isFresh(a, "y", 60_000)).toBe(true);
    expect(isFresh(a, "y", 61_500)).toBe(true);
    expect(isFresh(a, "y", 62_100)).toBe(false);
  });

  test("a workflow that recovers and fails again pulses again", () => {
    let a = trackArrivals(emptyArrivals(), ["x"], 0);
    a = trackArrivals(a, [], 10_000);
    a = trackArrivals(a, ["x"], 20_000);
    expect(isFresh(a, "x", 20_000)).toBe(true);
  });
});
