import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkForUpdate, isNewer } from "../src/update.ts";

let dir: string;
let cacheFile: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "update-test-"));
  cacheFile = join(dir, "update-check.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("isNewer", () => {
  test("compares semver, not strings", () => {
    expect(isNewer("0.10.0", "0.9.0")).toBe(true);
    expect(isNewer("0.9.0", "0.10.0")).toBe(false);
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
  });

  test("garbage is never newer", () => {
    expect(isNewer("not-a-version", "1.0.0")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  const base = { packageName: "@mklab-se/x", currentVersion: "1.0.0" };

  test("reports a newer version and caches it", async () => {
    const latest = await checkForUpdate({ ...base, cacheFile, fetchLatest: async () => "1.2.0" });
    expect(latest).toBe("1.2.0");
    expect((await Bun.file(cacheFile).json()).latest).toBe("1.2.0");
  });

  test("returns null when up to date", async () => {
    expect(
      await checkForUpdate({ ...base, cacheFile, fetchLatest: async () => "1.0.0" }),
    ).toBeNull();
  });

  test("uses a fresh cache without fetching", async () => {
    await Bun.write(cacheFile, JSON.stringify({ checkedAt: 1_000, latest: "2.0.0" }));
    const latest = await checkForUpdate({
      ...base,
      cacheFile,
      now: 1_000 + 60_000,
      fetchLatest: async () => {
        throw new Error("should not fetch");
      },
    });
    expect(latest).toBe("2.0.0");
  });

  test("refetches when the cache is older than a day", async () => {
    await Bun.write(cacheFile, JSON.stringify({ checkedAt: 0, latest: "2.0.0" }));
    const latest = await checkForUpdate({
      ...base,
      cacheFile,
      now: 25 * 60 * 60 * 1000,
      fetchLatest: async () => "1.0.0",
    });
    expect(latest).toBeNull();
  });

  test("never throws on network errors or a corrupt cache", async () => {
    await Bun.write(cacheFile, "{not json");
    const latest = await checkForUpdate({
      ...base,
      cacheFile,
      fetchLatest: async () => {
        throw new Error("offline");
      },
    });
    expect(latest).toBeNull();
  });
});
