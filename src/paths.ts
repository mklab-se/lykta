/**
 * Where the tool keeps its files. Every MKLab tool follows the same layout:
 * Linux and macOS use XDG (`$XDG_CONFIG_HOME/<tool>` or `~/.config/<tool>`,
 * `$XDG_CACHE_HOME/<tool>` or `~/.cache/<tool>`); Windows uses `%APPDATA%` and
 * `%LOCALAPPDATA%`. Never use `~/Library/...` on macOS.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { TOOL } from "./meta.ts";

type Env = Record<string, string | undefined>;

interface PathOptions {
  env?: Env;
  platform?: NodeJS.Platform;
  home?: string;
}

function resolve(kind: "config" | "cache", opts: PathOptions = {}): string {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? homedir();

  if (platform === "win32") {
    const base =
      kind === "config"
        ? (env.APPDATA ?? join(home, "AppData", "Roaming"))
        : (env.LOCALAPPDATA ?? join(home, "AppData", "Local"));
    return join(base, TOOL);
  }

  const xdg = kind === "config" ? env.XDG_CONFIG_HOME : env.XDG_CACHE_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(home, kind === "config" ? ".config" : ".cache");
  return join(base, TOOL);
}

export function configDir(opts?: PathOptions): string {
  return resolve("config", opts);
}

export function cacheDir(opts?: PathOptions): string {
  return resolve("cache", opts);
}
