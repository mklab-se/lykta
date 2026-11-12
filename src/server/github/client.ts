/**
 * GitHub REST client: one serial queue per organization, ETags (304 answers do not count
 * against the rate limit), rate-limit tracking, and waiting instead of hammering when
 * GitHub says to slow down. Errors never include a token.
 */
import { formatClock } from "../../core/timing.ts";
import { API, AuthError, apiHeaders, TIMEOUT_MS, type TokenProvider } from "./auth.ts";

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly acceptedPermissions?: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/** GitHub asked us to slow down; the organization is paused until `until`. */
export class RateLimitError extends GitHubError {
  constructor(
    message: string,
    status: number,
    readonly until: number,
  ) {
    super(message, status);
    this.name = "RateLimitError";
  }
}

/** The last `max` bytes of a response body, read as a stream and cut at a line start. */
async function tail(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  let cut = false;
  for await (const chunk of res.body) {
    chunks.push(chunk);
    size += chunk.byteLength;
    while (size - (chunks[0]?.byteLength ?? 0) >= max && chunks.length > 1) {
      size -= (chunks.shift() as Uint8Array).byteLength;
      cut = true;
    }
  }
  let bytes = Buffer.concat(chunks);
  if (bytes.byteLength > max) {
    bytes = bytes.subarray(bytes.byteLength - max);
    cut = true;
  }
  let text = bytes.toString("utf8");
  if (cut) text = text.slice(text.indexOf("\n") + 1);
  return text;
}

export interface RateState {
  remaining: number;
  limit: number;
  resetAt: number;
}

const MIN_RATE_WAIT_MS = 60_000;
const SERVER_RETRY_MS = 2_000;
const HOUR_MS = 3_600_000;
const MAX_ETAGS = 2_000;
/** A 6-hour Android build log can be hundreds of MB; the failure is near the end. */
export const MAX_LOG_BYTES = 4 * 1024 * 1024;

export class GitHubClient {
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly etags = new Map<string, { etag: string; body: unknown }>();
  private readonly rates = new Map<string, RateState>();
  private readonly pausedUntil = new Map<string, number>();
  /** When each request that counted against the rate limit was made, per org (last hour). */
  private readonly costs = new Map<string, number[]>();
  private readonly warnings = new Set<(message: string) => void>();

  constructor(
    private readonly opts: {
      tokens: TokenProvider;
      fetch?: typeof fetch;
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
      userAgent: string;
      timeoutMs?: number;
      maxEtags?: number;
    },
  ) {
    this.doFetch = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => Bun.sleep(ms));
  }

  onWarning(fn: (message: string) => void): void {
    this.warnings.add(fn);
  }

  rate(org: string): RateState | undefined {
    return this.rates.get(org);
  }

  /** Requests Lykta itself made against the org's rate limit in the last hour (304s are free). */
  spent(org: string): number {
    const list = this.costs.get(org) ?? [];
    const cutoff = this.now() - HOUR_MS;
    while (list.length && (list[0] as number) < cutoff) list.shift();
    return list.length;
  }

  /** JSON from the API; on 304 the cached body is returned with notModified true. */
  json<T>(org: string, path: string): Promise<{ data: T; notModified: boolean }> {
    return this.enqueue(org, async () => {
      const cached = this.etags.get(`${org}:${path}`);
      const res = await this.request(org, path, cached ? { "If-None-Match": cached.etag } : {});
      if (res.status === 304 && cached) {
        this.remember(`${org}:${path}`, cached);
        return { data: cached.body as T, notModified: true };
      }
      const data = (await res.json()) as T;
      const etag = res.headers.get("etag");
      if (etag) this.remember(`${org}:${path}`, { etag, body: data });
      return { data, notModified: false };
    });
  }

  /**
   * Plain text, following GitHub's redirect to the log storage (without our token). Keeps
   * only the last `maxBytes`, starting at a whole line, so a huge log never fills memory.
   */
  text(org: string, path: string, maxBytes = MAX_LOG_BYTES): Promise<string> {
    return this.enqueue(org, async () => {
      const res = await this.request(org, path, {}, "manual");
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        const out = await this.fetchWithTimeout(path, location, {});
        if (!out.ok)
          throw new GitHubError(`Could not download ${path} (HTTP ${out.status})`, out.status);
        return tail(out, maxBytes);
      }
      return tail(res, maxBytes);
    });
  }

  /** Least recently used ETag cache, so weeks of new run ids never grow it without bound. */
  private remember(key: string, entry: { etag: string; body: unknown }): void {
    this.etags.delete(key);
    this.etags.set(key, entry);
    const max = this.opts.maxEtags ?? MAX_ETAGS;
    while (this.etags.size > max) {
      const oldest = this.etags.keys().next().value;
      if (oldest === undefined) break;
      this.etags.delete(oldest);
    }
  }

  private enqueue<T>(org: string, task: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(org) ?? Promise.resolve();
    const next = prev.then(task, task);
    this.queues.set(
      org,
      next.catch(() => {}),
    );
    return next;
  }

  private async request(
    org: string,
    path: string,
    extra: Record<string, string>,
    redirect: RequestRedirect = "follow",
    attempt = 0,
  ): Promise<Response> {
    const paused = this.pausedUntil.get(org) ?? 0;
    if (this.now() < paused)
      throw new RateLimitError(
        `GitHub rate limit for ${org}: data delayed until ${formatClock(paused)}`,
        429,
        paused,
      );
    const token = await this.opts.tokens.token(org);
    const res = await this.fetchWithTimeout(path, `${API}${path}`, {
      headers: { ...apiHeaders(token, this.opts.userAgent), ...extra },
      redirect,
    });
    this.track(org, res);
    if (await this.limited(res)) {
      const until = this.now() + this.rateWait(org, res);
      this.pausedUntil.set(org, until);
      const message = `GitHub rate limit for ${org}: data delayed until ${formatClock(until)}`;
      this.warn(message);
      throw new RateLimitError(message, res.status, until);
    }
    if (res.status >= 500 && attempt === 0) {
      await this.sleep(SERVER_RETRY_MS);
      return this.request(org, path, extra, redirect, 1);
    }
    if (
      res.ok ||
      res.status === 304 ||
      (redirect === "manual" && res.status >= 300 && res.status < 400)
    )
      return res;
    let detail = "";
    try {
      detail = ((await res.json()) as { message?: string }).message ?? "";
    } catch {}
    if (res.status === 401)
      throw new AuthError(org, `${detail || "GitHub refused the credentials"} (HTTP 401)`);
    throw new GitHubError(
      `GitHub API ${res.status} for ${path}${detail ? `: ${detail}` : ""}`,
      res.status,
      res.headers.get("x-accepted-github-permissions") ?? undefined,
    );
  }

  private async fetchWithTimeout(path: string, url: string, init: RequestInit): Promise<Response> {
    const ms = this.opts.timeoutMs ?? TIMEOUT_MS;
    try {
      return await this.doFetch(url, { ...init, signal: AbortSignal.timeout(ms) });
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))
        throw new Error(
          `GitHub did not answer ${path} within ${Math.round(ms / 1000)} s (timed out)`,
        );
      throw e;
    }
  }

  /** 429, or a 403 that is really a (primary or secondary) rate limit, not missing access. */
  private async limited(res: Response): Promise<boolean> {
    if (res.status === 429) return true;
    if (res.status !== 403) return false;
    if (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after"))
      return true;
    try {
      const body = (await res.clone().json()) as { message?: string };
      return /rate limit/i.test(body.message ?? "");
    } catch {
      return false;
    }
  }

  private rateWait(org: string, res: Response): number {
    const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
    if (Number.isFinite(retryAfter)) return retryAfter * 1000;
    const reset = this.rates.get(org)?.resetAt ?? 0;
    return Math.max(MIN_RATE_WAIT_MS, reset - this.now());
  }

  private track(org: string, res: Response): void {
    if (res.status !== 304) {
      const list = this.costs.get(org) ?? [];
      list.push(this.now());
      this.costs.set(org, list);
      this.spent(org); // prune
    }
    const remaining = Number.parseInt(res.headers.get("x-ratelimit-remaining") ?? "", 10);
    const limit = Number.parseInt(res.headers.get("x-ratelimit-limit") ?? "", 10);
    const reset = Number.parseInt(res.headers.get("x-ratelimit-reset") ?? "", 10);
    if (Number.isFinite(remaining) && Number.isFinite(limit)) {
      this.rates.set(org, { remaining, limit, resetAt: Number.isFinite(reset) ? reset * 1000 : 0 });
    }
  }

  private warn(message: string): void {
    for (const fn of this.warnings) fn(message);
  }
}
