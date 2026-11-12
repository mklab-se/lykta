/**
 * `lykta serve`: the dashboard with real data from GitHub.
 */

import { VERSION } from "../meta.ts";
import { ConfigError, loadConfig, loadSecrets } from "../server/config.ts";
import { createTokenProvider } from "../server/github/auth.ts";
import { GitHubClient } from "../server/github/client.ts";
import { GitHubSource } from "../server/github/source.ts";
import { startServer } from "../server/http.ts";
import { Hub } from "../server/hub.ts";
import { buildVersion } from "./demo.ts";

export interface ServeOptions {
  config?: string;
  port?: number;
  host?: string;
}

export async function runServe(opts: ServeOptions): Promise<void> {
  let config: Awaited<ReturnType<typeof loadConfig>>;
  let secrets: Awaited<ReturnType<typeof loadSecrets>>;
  try {
    config = await loadConfig({ path: opts.config });
    secrets = await loadSecrets(config);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      process.exit(2);
    }
    throw e;
  }
  const client = new GitHubClient({
    tokens: createTokenProvider({ config, secrets }),
    userAgent: `lykta/${VERSION}`,
  });
  const hub = new Hub(
    buildVersion(),
    {
      lowPower: config.display.lowPower,
      demo: false,
      holdFailedSeconds: config.display.holdFailedSeconds,
      holdPassedSeconds: config.display.holdPassedSeconds,
    },
    config.title,
  );
  const source = new GitHubSource({ config, client });
  source.onWarnings((w) => {
    hub.setWarnings(w);
    for (const m of w) console.warn(`warning: ${m}`);
  });
  let lastSummary = "";
  source.start((inputs) => {
    hub.update(inputs);
    const entries = hub.snapshot().entries;
    const failing = entries.filter((e) => e.failing || e.state === "missing").length;
    const running = entries.filter((e) => e.state === "running").length;
    const rates = Object.keys(config.organizations)
      .map((org) => {
        const r = client.rate(org);
        return r ? `${org} ${r.remaining}/${r.limit}` : "";
      })
      .filter(Boolean)
      .join(", ");
    const summary = `${entries.length} monitored, ${failing} failing, ${running} running`;
    if (summary !== lastSummary) console.log(`${summary}${rates ? ` (rate: ${rates})` : ""}`);
    lastSummary = summary;
  });
  const port = opts.port ?? config.server.port;
  const host = opts.host ?? config.server.host;
  const server = startServer({ port, hostname: host, hub, source });
  console.log(`Lykta serving http://${host === "0.0.0.0" ? "localhost" : host}:${server.port}`);
  await new Promise(() => {});
}
