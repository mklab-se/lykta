import { expect, test } from "bun:test";
import { moveFocus } from "../../src/web/focus.ts";

test("focus moves in order and wraps", () => {
  const keys = ["f1", "r1", "m1", "m2"];
  expect(moveFocus(keys, null, "down")).toBe("f1");
  expect(moveFocus(keys, "f1", "down")).toBe("r1");
  expect(moveFocus(keys, "r1", "right")).toBe("m1");
  expect(moveFocus(keys, "m2", "down")).toBe("f1");
  expect(moveFocus(keys, "f1", "up")).toBe("m2");
  expect(moveFocus(keys, "gone", "left")).toBe("f1");
  expect(moveFocus([], "f1", "down")).toBeNull();
});
