import { expect, test } from "bun:test";
import { idleRemaining } from "../../src/web/idle.ts";

test("auto close after 60 seconds", () => {
  expect(idleRemaining(0, 0)).toBe(60_000);
  expect(idleRemaining(0, 50_000)).toBe(10_000);
  expect(idleRemaining(0, 60_000)).toBe(0);
  expect(idleRemaining(0, 90_000)).toBe(0);
  expect(idleRemaining(0, 5_000, 10_000)).toBe(5_000);
});
