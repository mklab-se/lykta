import { describe, expect, test } from "bun:test";
import type { TokenProvider } from "../../src/server/github/auth.ts";
import { GitHubClient, GitHubError } from "../../src/server/github/client.ts";

const tokens: TokenProvider = { token: async (org) => `tok-${org}`, kind: () => "token" };

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
function client(handler: Handler, sleeps: number[] = []) {
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

  test("rate limit waits and warns", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const { c, warnings } = client(() => {
      n++;
      if (n === 1)
        return new Response("slow down", {
          status: 429,
          headers: { "retry-after": "30", ...rateHeaders(0) },
        });
      return Response.json({ ok: true }, { headers: rateHeaders() });
    }, sleeps);
    const r = await c.json<{ ok: boolean }>("acme", "/x");
    expect(r.data.ok).toBe(true);
    expect(sleeps).toEqual([30_000]);
    expect(warnings[0]).toContain("GitHub rate limit for acme");
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
});
