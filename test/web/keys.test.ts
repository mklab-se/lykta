import { expect, test } from "bun:test";
import { uniqueKeys } from "../../src/web/keys.ts";

test("repeated texts get distinct keys", () => {
  expect(uniqueKeys(["a", "b", "a"])).toEqual(["1:a", "1:b", "2:a"]);
});
