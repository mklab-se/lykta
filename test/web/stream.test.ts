import { describe, expect, test } from "bun:test";
import type { DashboardState } from "../../src/core/types.ts";
import { initialStream, isStale, reduceStream, reloadWhenHealthy } from "../../src/web/stream.ts";

const snap = (version: string, keys: string[]): DashboardState => ({
  version,
  generatedAt: "2026-11-12T10:00:00Z",
  entries: keys.map((key) => ({
    key,
    name: key,
    repo: "o/r",
    branch: "main",
    state: "passed",
    failing: false,
    history: [],
  })),
  warnings: [],
});

describe("stream", () => {
  test("reconnect replaces state", () => {
    let s = reduceStream(initialStream(), { type: "snapshot", data: snap("1", ["a", "b"]), at: 1 });
    s = reduceStream(s, { type: "disconnected" });
    expect(s.connected).toBe(false);
    s = reduceStream(s, { type: "snapshot", data: snap("1", ["c"]), at: 2 });
    expect(s.data?.entries.map((e) => e.key)).toEqual(["c"]);
    expect(s.connected).toBe(true);
    expect(s.reload).toBe(false);
  });

  test("version change requests reload", () => {
    let s = reduceStream(initialStream(), { type: "snapshot", data: snap("1", []), at: 1 });
    s = reduceStream(s, { type: "snapshot", data: snap("2", []), at: 2 });
    expect(s.reload).toBe(true);
  });

  test("stale after 3 minutes", () => {
    const s = reduceStream(initialStream(), { type: "snapshot", data: snap("1", []), at: 0 });
    expect(isStale(s, 179_000)).toBe(false);
    expect(isStale(s, 181_000)).toBe(true);
    const pinged = reduceStream(s, { type: "ping", at: 170_000 });
    expect(isStale(pinged, 181_000)).toBe(false);
  });

  test("nightly reload only when the server answers", async () => {
    let reloaded = 0;
    let retried = 0;
    const ok = async () => new Response("ok");
    const down = async () => {
      throw new Error("offline");
    };
    const deps = (f: (url: string) => Promise<Response>) => ({
      fetch: f,
      reload: () => reloaded++,
      retryLater: () => retried++,
    });
    await reloadWhenHealthy(deps(down));
    expect([reloaded, retried]).toEqual([0, 1]);
    await reloadWhenHealthy(deps(async () => new Response("no", { status: 503 })));
    expect([reloaded, retried]).toEqual([0, 2]);
    await reloadWhenHealthy(deps(ok));
    expect([reloaded, retried]).toEqual([1, 2]);
  });
});
