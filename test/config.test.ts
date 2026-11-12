import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, loadConfig, saveConfig } from "../src/config.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "config-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("a missing config file loads as empty", async () => {
  expect(await loadConfig(configPath(dir))).toEqual({});
});

test("save then load round-trips, creating the directory", async () => {
  const path = configPath(join(dir, "nested"));
  await saveConfig({ name: "x", nested: { n: 1 } }, path);
  expect(await loadConfig(path)).toEqual({ name: "x", nested: { n: 1 } });
});

test("a non-mapping top level is rejected", async () => {
  const path = configPath(dir);
  await Bun.write(path, "- a\n- b\n");
  expect(loadConfig(path)).rejects.toThrow("expected a YAML mapping");
});
