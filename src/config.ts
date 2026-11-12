/**
 * YAML configuration in `configDir()/config.yaml`. A reusable starting point:
 * add fields to `Config` as the tool needs them.
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { configDir } from "./paths.ts";

export interface Config {
  /** Free-form settings; replace with typed fields for your tool. */
  [key: string]: unknown;
}

export function configPath(dir: string = configDir()): string {
  return join(dir, "config.yaml");
}

/** Load the config, or an empty one if the file does not exist yet. */
export async function loadConfig(path: string = configPath()): Promise<Config> {
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  const parsed = Bun.YAML.parse(await file.text());
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path}: expected a YAML mapping at the top level`);
  }
  return parsed as Config;
}

export async function saveConfig(config: Config, path: string = configPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, Bun.YAML.stringify(config, null, 2));
}
