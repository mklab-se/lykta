import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { TOOL } from "../src/meta.ts";
import { cacheDir, configDir } from "../src/paths.ts";

const home = "/home/u";

describe("paths", () => {
  test("XDG variables win on Linux and macOS", () => {
    for (const platform of ["linux", "darwin"] as const) {
      const env = { XDG_CONFIG_HOME: "/x/config", XDG_CACHE_HOME: "/x/cache" };
      expect(configDir({ env, platform, home })).toBe(join("/x/config", TOOL));
      expect(cacheDir({ env, platform, home })).toBe(join("/x/cache", TOOL));
    }
  });

  test("falls back to ~/.config and ~/.cache, never ~/Library on macOS", () => {
    expect(configDir({ env: {}, platform: "darwin", home })).toBe(join(home, ".config", TOOL));
    expect(cacheDir({ env: {}, platform: "darwin", home })).toBe(join(home, ".cache", TOOL));
  });

  test("an empty XDG variable is ignored", () => {
    expect(configDir({ env: { XDG_CONFIG_HOME: "" }, platform: "linux", home })).toBe(
      join(home, ".config", TOOL),
    );
  });

  test("Windows uses APPDATA and LOCALAPPDATA", () => {
    const env = { APPDATA: "C:/Roaming", LOCALAPPDATA: "C:/Local" };
    expect(configDir({ env, platform: "win32", home })).toBe(join("C:/Roaming", TOOL));
    expect(cacheDir({ env, platform: "win32", home })).toBe(join("C:/Local", TOOL));
  });
});
