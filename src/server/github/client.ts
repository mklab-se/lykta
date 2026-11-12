/**
 * GitHub REST client: one serial queue per organization, ETags (304 answers do not count
 * against the rate limit), rate-limit tracking, and waiting instead of hammering when
 * GitHub says to slow down. Errors never include a token.
 */
import { formatClock } from "../../core/timing.ts";
import { API, apiHeaders, type TokenProvider } from "./auth.ts";

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

export interface RateState {
  remaining: number;
  limit: number;
  resetAt: number;
}

const MIN_RATE_WAIT_MS = 60_000;
const SERVER_RETRY_MS = 2_000;

export class GitHubClient {
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly etags = new Map<string, { etag: string; body: unknown }>();
  private readonly rates = new Map<string, RateState>();
  private readonly warnings = new Set<(message: string) => void>();

  constructor(
    private readonly opts: {
      tokens: TokenProvider;
      fetch?: typeof fetch;
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
      userAgent: string;
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

  /** JSON from the API; on 304 the cached body is returned with notModified true. */
  json<T>(org: string, path: string): Promise<{ data: T; notModified: boolean }> {
    return this.enqueue(org, async () => {
      const cached = this.etags.get(`${org}:${path}`);
      const res = await this.request(org, path, cached ? { "If-None-Match": cached.etag } : {});
      if (res.status === 304 && cached) return { data: cached.body as T, notModified: true };
      const data = (await res.json()) as T;
      const etag = res.headers.get("etag");
      if (etag) this.etags.set(`${org}:${path}`, { etag, body: data });
      return { data, notModified: false };
    });
  }

  /** Plain text, following GitHub's redirect to the log storage (without our token). */
  text(org: string, path: string): Promise<string> {
    return this.enqueue(org, async () => {
      const res = await this.request(org, path, {}, "manual");
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        const out = await this.doFetch(location);
        if (!out.ok)
          throw new GitHubError(`Could not download ${path} (HTTP ${out.status})`, out.status);
        return out.text();
      }
      return res.text();
    });
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
    const token = await this.opts.tokens.token(org);
    const res = await this.doFetch(`${API}${path}`, {
      headers: { ...apiHeaders(token, this.opts.userAgent), ...extra },
      redirect,
    });
    this.track(org, res);
    const limited =
      res.status === 429 ||
      (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0");
    if (limited && attempt === 0) {
      const wait = this.rateWait(org, res);
      this.warn(
        `GitHub rate limit for ${org}: data delayed until ${formatClock(this.now() + wait)}`,
      );
      await this.sleep(wait);
      return this.request(org, path, extra, redirect, 1);
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
    throw new GitHubError(
      `GitHub API ${res.status} for ${path}${detail ? `: ${detail}` : ""}`,
      res.status,
      res.headers.get("x-accepted-github-permissions") ?? undefined,
    );
  }

  private rateWait(org: string, res: Response): number {
    const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
    if (Number.isFinite(retryAfter)) return retryAfter * 1000;
    const reset = this.rates.get(org)?.resetAt ?? 0;
    return Math.max(MIN_RATE_WAIT_MS, reset - this.now());
  }

  private track(org: string, res: Response): void {
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
