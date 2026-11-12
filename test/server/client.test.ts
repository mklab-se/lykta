import { describe, expect, test } from "bun:test";
import { AuthError, type TokenProvider } from "../../src/server/github/auth.ts";
import { GitHubClient, GitHubError, RateLimitError } from "../../src/server/github/client.ts";

const tokens: TokenProvider = { token: async (org) => `tok-${org}`, kind: () => "token" };

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
function client(handler: Handler, sleeps: number[] = [], timeoutMs?: number) {
  const warnings: string[] = [];
  const c = new GitHubClient({
    tokens,
    fetch: (async (url: string | URL | Request, init?: RequestInit) =>
      handler(String(url), init ?? {})) as typeof fetch,
    now: () => Date.UTC(2026, 10, 12, 12, 0),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    userAgent: "lykta/test",
    timeoutMs,
  });
  c.onWarning((w) => warnings.push(w));
  return { c, warnings };
}

const rateHeaders = (remaining = 4999) => ({
  "x-ratelimit-remaining": String(remaining),
  "x-ratelimit-limit": "5000",
  "x-ratelimit-reset": String(Date.UTC(2026, 10, 12, 13, 0) / 1000),
});

describe("GitHubClient", () => {
  test("sends version and auth headers", async () => {
    let seen: Headers | undefined;
    const { c } = client((_, init) => {
      seen = new Headers(init.headers);
      return Response.json({ ok: 1 }, { headers: rateHeaders() });
    });
    await c.json("mklab-se", "/repos/mklab-se/lykta");
    expect(seen?.get("authorization")).toBe("Bearer tok-mklab-se");
    expect(seen?.get("x-github-api-version")).toBe("2026-03-10");
    expect(seen?.get("user-agent")).toBe("lykta/test");
    expect(c.rate("mklab-se")?.remaining).toBe(4999);
  });

  test("uses ETags and returns cached body on 304", async () => {
    let calls = 0;
    const { c } = client((_, init) => {
      calls++;
      if (new Headers(init.headers).get("if-none-match") === '"v1"')
        return new Response(null, { status: 304, headers: rateHeaders() });
      return Response.json({ n: 1 }, { headers: { etag: '"v1"', ...rateHeaders() } });
    });
    const a = await c.json<{ n: number }>("o", "/x");
    const b = await c.json<{ n: number }>("o", "/x");
    expect(a).toEqual({ data: { n: 1 }, notModified: false });
    expect(b).toEqual({ data: { n: 1 }, notModified: true });
    expect(calls).toBe(2);
  });

  test("a rate limit pauses the organization instead of waiting in its queue", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const { c, warnings } = client((url) => {
      n++;
      if (url.includes("/acme"))
        return new Response("slow down", {
          status: 429,
          headers: { "retry-after": "30", ...rateHeaders(0) },
        });
      return Response.json({ ok: true }, { headers: rateHeaders() });
    }, sleeps);
    await expect(c.json("acme", "/acme/x")).rejects.toBeInstanceOf(RateLimitError);
    expect(warnings[0]).toContain("GitHub rate limit for acme");
    // paused: no further calls until the reset, and nothing sleeps in the queue
    await expect(c.json("acme", "/acme/y")).rejects.toBeInstanceOf(RateLimitError);
    expect(n).toBe(1);
    expect(sleeps).toEqual([]);
    // other organizations carry on
    expect((await c.json<{ ok: boolean }>("other", "/other/x")).data.ok).toBe(true);
  });

  test("a 403 rate limit is a rate limit, not missing access", async () => {
    const { c } = client(
      () =>
        new Response(JSON.stringify({ message: "You have exceeded a secondary rate limit" }), {
          status: 403,
          headers: rateHeaders(),
        }),
    );
    await expect(c.json("acme", "/x")).rejects.toBeInstanceOf(RateLimitError);
  });

  test("spent counts only answers that cost against the rate limit", async () => {
    let n = 0;
    const { c } = client(() => {
      n++;
      if (n === 2) return new Response(null, { status: 304, headers: rateHeaders() });
      return Response.json({}, { headers: { etag: '"e"', ...rateHeaders() } });
    });
    await c.json("o", "/a");
    await c.json("o", "/a");
    await c.json("o", "/b");
    expect(c.spent("o")).toBe(2);
    expect(c.spent("p")).toBe(0);
  });

  test("serial per org", async () => {
    let active = 0;
    let maxActive = 0;
    const { c } = client(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Bun.sleep(10);
      active--;
      return Response.json({}, { headers: rateHeaders() });
    });
    await Promise.all([c.json("o", "/a"), c.json("o", "/b"), c.json("o", "/c")]);
    expect(maxActive).toBe(1);
    maxActive = 0;
    await Promise.all([c.json("o", "/a2"), c.json("p", "/b2")]);
    expect(maxActive).toBe(2);
  });

  test("errors carry status and permissions, never the token", async () => {
    const { c } = client(
      () =>
        new Response(JSON.stringify({ message: "Resource not accessible by integration" }), {
          status: 403,
          headers: { "x-accepted-github-permissions": "actions=read", ...rateHeaders() },
        }),
    );
    try {
      await c.json("mklab-se", "/repos/mklab-se/secret");
      throw new Error("expected GitHubError");
    } catch (e) {
      expect(e).toBeInstanceOf(GitHubError);
      expect((e as GitHubError).status).toBe(403);
      expect((e as GitHubError).acceptedPermissions).toBe("actions=read");
      expect(String((e as Error).message)).not.toContain("tok-");
    }
  });

  test("text follows the logs redirect", async () => {
    const { c } = client((url) =>
      url.endsWith("/logs")
        ? new Response(null, {
            status: 302,
            headers: { location: "https://logs.example/x", ...rateHeaders() },
          })
        : new Response("log line", { status: 200 }),
    );
    expect(await c.text("o", "/repos/o/r/actions/jobs/1/logs")).toBe("log line");
  });

  test("a request that hangs times out", async () => {
    const { c } = client(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
        ),
      [],
      20,
    );
    await expect(c.json("o", "/slow")).rejects.toThrow("timed out");
  });

  test("401 is an AuthError for the organization", async () => {
    const { c } = client(
      () =>
        new Response(JSON.stringify({ message: "Bad credentials" }), {
          status: 401,
          headers: rateHeaders(),
        }),
    );
    const err = await c.json("acme", "/x").catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).org).toBe("acme");
  });
});
