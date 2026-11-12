/**
 * Signing in to GitHub per organization: a fine-grained token, or a GitHub App installation
 * token (short-lived, refreshed automatically). Errors never contain a credential.
 */
import { createSign } from "node:crypto";
import type { LyktaConfig, Secrets } from "../config.ts";

export const API = "https://api.github.com";
export const API_VERSION = "2026-03-10";
const REFRESH_EARLY_MS = 5 * 60_000;
/** Every call to GitHub gives up after this long, so a hung connection never stalls polling. */
export const TIMEOUT_MS = 30_000;
const MISSING_RETRY_MS = 10 * 60_000;

export interface TokenProvider {
  token(org: string): Promise<string>;
  kind(org: string): "app" | "token";
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** RS256 JWT for the App: issued 60 s in the past (clock drift), valid 9 minutes. */
export function appJwt(appId: string, privateKeyPem: string, now: number): string {
  const sec = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: sec - 60, exp: sec + 540, iss: appId }));
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKeyPem);
  return `${header}.${payload}.${b64url(signature)}`;
}

export function apiHeaders(token: string, userAgent = "lykta"): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": userAgent,
  };
}

/** Lykta cannot sign in to an organization; every entry of that org shows it. */
export class AuthError extends Error {
  constructor(
    readonly org: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function createTokenProvider(opts: {
  config: LyktaConfig;
  secrets: Secrets;
  fetch?: typeof fetch;
  now?: () => number;
}): TokenProvider {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const installations = new Map<string, number>();
  const missing = new Map<string, number>(); // org -> when to look for the installation again
  const cache = new Map<string, { token: string; expiresAt: number }>();

  const kind = (org: string) => opts.config.organizations[org]?.auth ?? "token";

  async function installationId(org: string, jwt: string): Promise<number> {
    const known = installations.get(org);
    if (known) return known;
    const message = `No GitHub App installation for ${org}: install the App in that organization`;
    if ((missing.get(org) ?? 0) > now()) throw new AuthError(org, message);
    for (const path of [`/orgs/${org}/installation`, `/users/${org}/installation`]) {
      const res = await doFetch(`${API}${path}`, {
        headers: apiHeaders(jwt),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) {
        const id = ((await res.json()) as { id: number }).id;
        installations.set(org, id);
        missing.delete(org);
        return id;
      }
    }
    missing.set(org, now() + MISSING_RETRY_MS);
    throw new AuthError(org, message);
  }

  async function appToken(org: string): Promise<string> {
    const cached = cache.get(org);
    if (cached && now() < cached.expiresAt - REFRESH_EARLY_MS) return cached.token;
    const { appId, appPrivateKey } = opts.secrets;
    if (!appId || !appPrivateKey)
      throw new AuthError(org, `GitHub App credentials are missing for ${org}`);
    const jwt = appJwt(appId, appPrivateKey, now());
    const id = await installationId(org, jwt);
    const res = await doFetch(`${API}/app/installations/${id}/access_tokens`, {
      method: "POST",
      headers: apiHeaders(jwt),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      installations.delete(org); // removed or reinstalled: look it up again next time
      throw new AuthError(
        org,
        `Could not get an installation token for ${org} (HTTP ${res.status})`,
      );
    }
    if (!res.ok)
      throw new Error(`Could not get an installation token for ${org} (HTTP ${res.status})`);
    const body = (await res.json()) as { token: string; expires_at: string };
    cache.set(org, { token: body.token, expiresAt: Date.parse(body.expires_at) });
    return body.token;
  }

  return {
    kind,
    async token(org) {
      if (kind(org) === "app") return appToken(org);
      const t = opts.secrets.tokens[org];
      if (!t) throw new AuthError(org, `No token for ${org}`);
      return t;
    },
  };
}
