import { describe, expect, test } from "bun:test";
import { dwellSeconds, nextSelection } from "../../src/web/rotation.ts";

describe("rotation", () => {
  test("dwell is 6 to 12 seconds", () => {
    expect(dwellSeconds(2)).toBe(12);
    expect(dwellSeconds(3)).toBe(10);
    expect(dwellSeconds(5)).toBe(6);
    expect(dwellSeconds(20)).toBe(6);
    expect(dwellSeconds(1)).toBe(12);
  });

  test("rotation wraps", () => {
    const keys = ["a", "b", "c"];
    let s = nextSelection({ selectedKey: null, selectedAt: 0 }, keys, 0);
    expect(s.selectedKey).toBe("a");
    s = nextSelection(s, keys, 9_999);
    expect(s.selectedKey).toBe("a");
    s = nextSelection(s, keys, 10_000);
    expect(s.selectedKey).toBe("b");
    s = nextSelection(s, keys, 20_000);
    s = nextSelection(s, keys, 30_000);
    expect(s.selectedKey).toBe("a");
  });

  test("rotation jumps to failing run", () => {
    const s = nextSelection({ selectedKey: "a", selectedAt: 0 }, ["a", "b", "c"], 1_000, "c");
    expect(s).toEqual({ selectedKey: "c", selectedAt: 1_000 });
  });

  test("rotation keeps selection while still running", () => {
    const s = nextSelection({ selectedKey: "b", selectedAt: 0 }, ["a", "b"], 5_000);
    expect(s.selectedKey).toBe("b");
    const gone = nextSelection({ selectedKey: "x", selectedAt: 0 }, ["a", "b"], 5_000);
    expect(gone).toEqual({ selectedKey: "a", selectedAt: 5_000 });
    expect(nextSelection({ selectedKey: "a", selectedAt: 0 }, [], 1)).toEqual({
      selectedKey: null,
      selectedAt: 1,
    });
  });
});
