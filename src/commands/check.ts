/**
 * `lykta check`: is the configuration right? Signs in to each organization and runs one
 * real sync, so it reports exactly what the wall would show.
 */
import { deriveEntry } from "../core/state.ts";
import { formatAgo } from "../core/timing.ts";
import type { EntryInput } from "../core/types.ts";
import { VERSION } from "../meta.ts";
import { ConfigError, type LyktaConfig, loadConfig, loadSecrets } from "../server/config.ts";
import { createTokenProvider } from "../server/github/auth.ts";
import { GitHubClient } from "../server/github/client.ts";
import { type GitHubApi, GitHubSource } from "../server/github/source.ts";

export async function runCheck(
  config: LyktaConfig,
  client: GitHubApi,
  now: () => number = Date.now,
): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  let ok = true;
  const reachable = new Set<string>();
  for (const [org, o] of Object.entries(config.organizations)) {
    try {
      const { data } = await client.json<{ rate: { remaining: number; limit: number } }>(
        org,
        "/rate_limit",
      );
      reachable.add(org);
      lines.push(
        `✓ ${org}: signed in with ${o.auth === "app" ? "the GitHub App" : "a token"} (rate ${data.rate.remaining}/${data.rate.limit})`,
      );
    } catch (e) {
      ok = false;
      lines.push(`✗ ${org}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const usable = {
    ...config,
    monitor: config.monitor.filter((m) => reachable.has(m.repo.split("/")[0] as string)),
  };
  let inputs: EntryInput[] = [];
  const source = new GitHubSource({ config: usable, client, now, schedule: () => 0 });
  source.start((i) => {
    inputs = i;
  });
  await source.firstSync;
  source.stop();
  for (const input of inputs) {
    const m = input.entry;
    const where = `(${m.repo} ${m.workflow} ${m.branch})`;
    const v = deriveEntry(input);
    if (input.problem) {
      ok = false;
      lines.push(`✗ ${m.name} ${where}: ${input.problem}`);
    } else if (v.state === "never") {
      lines.push(`✓ ${m.name} ${where}: no runs on ${m.branch} yet`);
    } else {
      const run = input.runs[0];
      const status = run?.status === "completed" ? `last run ${run.conclusion}` : "running now";
      const when = run?.createdAt ? ` ${formatAgo(now() - Date.parse(run.createdAt))}` : "";
      lines.push(`✓ ${m.name} ${where}: ${status}${when}`);
    }
  }
  for (const m of config.monitor) {
    if (!reachable.has(m.repo.split("/")[0] as string))
      lines.push(`✗ ${m.name} (${m.repo} ${m.workflow} ${m.branch}): organization not reachable`);
  }
  return { ok, lines };
}

export async function runCheckCommand(opts: { config?: string }): Promise<void> {
  try {
    const config = await loadConfig({ path: opts.config });
    const secrets = await loadSecrets(config);
    const client = new GitHubClient({
      tokens: createTokenProvider({ config, secrets }),
      userAgent: `lykta/${VERSION}`,
    });
    const r = await runCheck(config, client);
    for (const l of r.lines) console.log(l);
    process.exit(r.ok ? 0 : 1);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      process.exit(2);
    }
    throw e;
  }
}
