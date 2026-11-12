import { describe, expect, test } from "bun:test";
import { shouldUseLowPower } from "../../src/web/power.ts";

describe("power", () => {
  test("low power when frames are slow", () => {
    const slow = Array(120).fill(33);
    const fast = Array(120).fill(16);
    expect(shouldUseLowPower(slow, "auto")).toBe(true);
    expect(shouldUseLowPower(fast, "auto")).toBe(false);
    expect(shouldUseLowPower(fast, "on")).toBe(true);
    expect(shouldUseLowPower(slow, "off")).toBe(false);
  });

  test("too few frames decide nothing", () => {
    expect(shouldUseLowPower([40, 40], "auto")).toBe(false);
  });

  test("median ignores a few long frames", () => {
    expect(shouldUseLowPower([...Array(110).fill(16), ...Array(10).fill(200)], "auto")).toBe(false);
  });
});
