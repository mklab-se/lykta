import { describe, expect, test } from "bun:test";
import type { EntryInput } from "../../src/core/types.ts";
import { Hub } from "../../src/server/hub.ts";

const input = (name: string): EntryInput => ({
  entry: { key: "k", repo: "o/r", workflow: "ci.yml", branch: "main", name },
  runs: [],
});

describe("Hub", () => {
  test("does not broadcast when nothing changed", () => {
    const hub = new Hub("1");
    let calls = 0;
    hub.subscribe(() => calls++);
    hub.update([input("CI")]);
    hub.update([input("CI")]);
    expect(calls).toBe(1);
    hub.update([input("Release")]);
    expect(calls).toBe(2);
  });

  test("serialises each snapshot once for every subscriber", () => {
    const hub = new Hub("1");
    const seen: string[] = [];
    hub.subscribe((json) => seen.push(json));
    hub.subscribe((json) => seen.push(json));
    hub.update([input("CI")]);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1] as string);
    expect(JSON.parse(seen[0] as string).entries[0].name).toBe("CI");
    expect(hub.serialized()).toBe(seen[0] as string);
  });

  test("warnings are broadcast and the snapshot says when synced", () => {
    const hub = new Hub("1");
    expect(hub.snapshot().synced).toBe(false);
    let last = "";
    hub.subscribe((json) => {
      last = json;
    });
    hub.update([input("CI")]);
    expect(hub.snapshot().synced).toBe(true);
    hub.setWarnings(["GitHub rate limit for acme: data delayed until 13:00"]);
    expect(JSON.parse(last).warnings).toEqual([
      "GitHub rate limit for acme: data delayed until 13:00",
    ]);
    let calls = 0;
    hub.subscribe(() => calls++);
    hub.setWarnings(["GitHub rate limit for acme: data delayed until 13:00"]);
    expect(calls).toBe(0);
  });
});
