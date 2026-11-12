/**
 * Background update check against the npm registry. The result is cached for
 * 24 hours in `cacheDir()`, and every failure (offline, unpublished package,
 * bad cache) is silent: an update check must never break the tool.
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cacheDir } from "./paths.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  checkedAt: number;
  latest: string;
}

export interface UpdateCheckOptions {
  packageName: string;
  currentVersion: string;
  cacheFile?: string;
  now?: number;
  fetchLatest?: (packageName: string) => Promise<string | null>;
}

export function isNewer(candidate: string, current: string): boolean {
  try {
    return Bun.semver.order(candidate, current) === 1;
  } catch {
    return false;
  }
}

export async function fetchLatestFromNpm(packageName: string): Promise<string | null> {
  const url = `https://registry.npmjs.org/${packageName.replace("/", "%2f")}/latest`;
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) return null;
  const body = (await res.json()) as { version?: unknown };
  return typeof body.version === "string" ? body.version : null;
}

async function readCache(path: string): Promise<CacheEntry | null> {
  try {
    const entry = (await Bun.file(path).json()) as Partial<CacheEntry>;
    if (typeof entry.checkedAt === "number" && typeof entry.latest === "string") {
      return entry as CacheEntry;
    }
  } catch {
    // Missing or corrupt cache: treat as no cache.
  }
  return null;
}

/** Returns the newer version if one is available, otherwise null. Never throws. */
export async function checkForUpdate(opts: UpdateCheckOptions): Promise<string | null> {
  const cacheFile = opts.cacheFile ?? join(cacheDir(), "update-check.json");
  const now = opts.now ?? Date.now();
  const fetchLatest = opts.fetchLatest ?? fetchLatestFromNpm;

  try {
    let latest: string | null = null;
    const cached = await readCache(cacheFile);
    if (cached && now - cached.checkedAt < DAY_MS) {
      latest = cached.latest;
    } else {
      latest = await fetchLatest(opts.packageName);
      if (latest) {
        await mkdir(dirname(cacheFile), { recursive: true });
        await Bun.write(cacheFile, JSON.stringify({ checkedAt: now, latest }));
      }
    }
    return latest && isNewer(latest, opts.currentVersion) ? latest : null;
  } catch {
    return null;
  }
}
