import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, verify } from "node:crypto";
import { loadSecrets, parseConfig } from "../../src/server/config.ts";
import { appJwt, createTokenProvider } from "../../src/server/github/auth.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const NOW = Date.UTC(2026, 10, 12, 12, 0);

const b64url = (s: string) => Buffer.from(s, "base64url");
function check(jwt: string) {
  const [h, p, sig] = jwt.split(".") as [string, string, string];
  expect(JSON.parse(b64url(h).toString())).toEqual({ alg: "RS256", typ: "JWT" });
  expect(verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, b64url(sig))).toBe(true);
  return JSON.parse(b64url(p).toString());
}

const appConfig = parseConfig(
  "organizations:\n  mklab-se:\n    auth: app\n  acme:\n    auth: token\nmonitor:\n  - repo: mklab-se/x\n    workflow: ci.yml\n",
  {},
);

describe("auth", () => {
  test("jwt has RS256 header and app claims", () => {
    const claims = check(appJwt("123", pkcs1, NOW));
    expect(claims).toEqual({ iss: "123", iat: NOW / 1000 - 60, exp: NOW / 1000 + 540 });
  });

  test("escaped PKCS1 key signs", async () => {
    const s = await loadSecrets(appConfig, {
      LYKTA_APP_ID: "123",
      LYKTA_APP_PRIVATE_KEY: pkcs1.replace(/\n/g, "\\n"),
      LYKTA_TOKEN_ACME: "t",
    });
    check(appJwt(s.appId as string, s.appPrivateKey as string, NOW));
  });

  test("installation token is cached and refreshed", async () => {
    let now = NOW;
    const calls: string[] = [];
    const fake = async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/orgs/mklab-se/installation")) return Response.json({ id: 42 });
      if (u.endsWith("/app/installations/42/access_tokens"))
        return Response.json(
          { token: `inst-${calls.length}`, expires_at: new Date(now + 60 * 60_000).toISOString() },
          { status: 201 },
        );
      return new Response("nope", { status: 404 });
    };
    const p = createTokenProvider({
      config: appConfig,
      secrets: { appId: "123", appPrivateKey: pkcs1, tokens: { acme: "pat" } },
      fetch: fake as typeof fetch,
      now: () => now,
    });
    const a = await p.token("mklab-se");
    const b = await p.token("mklab-se");
    expect(a).toBe(b);
    expect(calls.filter((c) => c.endsWith("/access_tokens"))).toHaveLength(1);
    now += 56 * 60_000;
    const c = await p.token("mklab-se");
    expect(c).not.toBe(a);
    expect(await p.token("acme")).toBe("pat");
    expect(p.kind("acme")).toBe("token");
  });

  test("missing installation is a clear error", async () => {
    const fake = async () => new Response("Not Found", { status: 404 });
    const p = createTokenProvider({
      config: appConfig,
      secrets: { appId: "123", appPrivateKey: pkcs1, tokens: {} },
      fetch: fake as unknown as typeof fetch,
      now: () => NOW,
    });
    await expect(p.token("mklab-se")).rejects.toThrow("No GitHub App installation for mklab-se");
  });
});
