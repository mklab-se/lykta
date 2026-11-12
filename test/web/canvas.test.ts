import { expect, test } from "bun:test";
import { virtualSize } from "../../src/web/canvas.ts";

test("virtual canvas", () => {
  expect(virtualSize(3840, 2160)).toEqual({ width: 1920, height: 1080, scale: 2 });
  expect(virtualSize(1920, 1080)).toEqual({ width: 1920, height: 1080, scale: 1 });
  expect(virtualSize(2000, 1255).height).toBe(1205);
});
