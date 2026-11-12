/**
 * Lykta's configuration: one YAML file (or LYKTA_CONFIG inline) plus environment overrides.
 * Secrets never live in the file; they come from LYKTA_* environment variables or *_FILE
 * variants, so they fit Kubernetes Secrets (spec section 4).
 */

export interface MonitorConfig {
  repo: string;
  workflow: string;
  branch: string;
  name: string;
  ignoreEvents: string[];
}

export interface RunnerRule {
  match: { runnerName?: string; label?: string; group?: string };
  kind: "gh" | "k8s" | "lab" | "self";
  label?: string;
}

export interface OrgConfig {
  auth: "app" | "token";
}

export interface LyktaConfig {
  title?: string;
  organizations: Record<string, OrgConfig>;
  monitor: MonitorConfig[];
  runners: RunnerRule[];
  server: { port: number; host: string };
  display: { lowPower: "auto" | "on" | "off" };
  /** budget: the share of each org's hourly rate limit Lykta may use (others share it). */
  polling: { activeSeconds: number; idleSeconds: number; budget: number };
}

export interface Secrets {
  appId?: string;
  appPrivateKey?: string;
  tokens: Record<string, string>;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Configuration problems:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;
type Obj = Record<string, unknown>;

export const entryKey = (m: MonitorConfig) => `${m.repo}:${m.workflow}:${m.branch}`;

/** LYKTA_TOKEN_<ORG>: upper-cased, "-" and "." become "_". */
export const tokenVar = (org: string) => `LYKTA_TOKEN_${org.toUpperCase().replace(/[-.]/g, "_")}`;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const strList = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export function parseConfig(yamlText: string, env: Env = process.env): LyktaConfig {
  const problems: string[] = [];
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(yamlText);
  } catch (e) {
    throw new ConfigError([`not valid YAML: ${(e as Error).message}`]);
  }
  if (!isObj(raw)) throw new ConfigError(["the configuration must be a YAML mapping"]);

  const defaults = isObj(raw.defaults) ? raw.defaults : {};
  const defaultBranch = str(defaults.branch) ?? "main";
  const defaultIgnore = strList(defaults.ignoreEvents);

  const organizations: Record<string, OrgConfig> = {};
  if (isObj(raw.organizations)) {
    for (const [org, v] of Object.entries(raw.organizations)) {
      const auth = isObj(v) ? v.auth : undefined;
      if (auth === "app" || auth === "token") organizations[org] = { auth };
      else problems.push(`organization ${org}: auth must be "app" or "token"`);
    }
  } else
    problems.push("organizations: list at least one organization and how Lykta signs in to it");

  const monitor: MonitorConfig[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(raw.monitor) ? raw.monitor : [];
  if (!Array.isArray(raw.monitor)) problems.push("monitor: list the workflows to monitor");
  for (const [i, m] of list.entries()) {
    const where = `monitor[${i}]`;
    if (!isObj(m)) {
      problems.push(`${where}: must be a mapping with repo and workflow`);
      continue;
    }
    const repo = str(m.repo);
    const workflow = str(m.workflow);
    if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
      problems.push(`${where}: repo must be owner/name`);
      continue;
    }
    if (!workflow) {
      problems.push(`${where}: workflow (the file name, e.g. ci.yml) is required`);
      continue;
    }
    const owner = repo.split("/")[0] as string;
    if (!organizations[owner])
      problems.push(`${where}: organization ${owner} is not listed under organizations`);
    const branch = str(m.branch) ?? defaultBranch;
    const base = workflow.replace(/\.ya?ml$/, "");
    const entry: MonitorConfig = {
      repo,
      workflow,
      branch,
      name: str(m.name) ?? (branch === defaultBranch ? base : `${base} · ${branch}`),
      ignoreEvents: m.ignoreEvents === undefined ? defaultIgnore : strList(m.ignoreEvents),
    };
    const key = entryKey(entry);
    if (seen.has(key)) problems.push(`${where}: ${repo} ${workflow} on ${branch} is listed twice`);
    seen.add(key);
    monitor.push(entry);
  }

  const runners: RunnerRule[] = [];
  for (const [i, r] of (Array.isArray(raw.runners) ? raw.runners : []).entries()) {
    const kind = isObj(r) ? r.kind : undefined;
    if (!isObj(r) || !isObj(r.match) || !["gh", "k8s", "lab", "self"].includes(kind as string)) {
      problems.push(`runners[${i}]: needs match and kind (gh, k8s, lab or self)`);
      continue;
    }
    runners.push({
      match: {
        runnerName: str(r.match.runnerName),
        label: str(r.match.label),
        group: str(r.match.group),
      },
      kind: kind as RunnerRule["kind"],
      label: str(r.label),
    });
  }

  const server = isObj(raw.server) ? raw.server : {};
  const display = isObj(raw.display) ? raw.display : {};
  const polling = isObj(raw.polling) ? raw.polling : {};
  const num = (v: unknown, d: number) => (typeof v === "number" && v > 0 ? v : d);
  const port = env.LYKTA_PORT ? Number.parseInt(env.LYKTA_PORT, 10) : num(server.port, 8080);
  if (!Number.isInteger(port) || port <= 0 || port > 65535)
    problems.push(`server.port: ${port} is not a valid port`);
  const lowPower = env.LYKTA_LOW_POWER ?? display.lowPower ?? "auto";
  if (!["auto", "on", "off"].includes(lowPower as string))
    problems.push(`display.lowPower must be auto, on or off`);

  if (problems.length) throw new ConfigError(problems);
  return {
    title: env.LYKTA_TITLE ?? str(raw.title),
    organizations,
    monitor,
    runners,
    server: { port, host: env.LYKTA_HOST ?? str(server.host) ?? "0.0.0.0" },
    display: { lowPower: lowPower as LyktaConfig["display"]["lowPower"] },
    polling: {
      activeSeconds: num(polling.activeSeconds, 15),
      idleSeconds: num(polling.idleSeconds, 60),
      budget: Math.min(1, num(polling.budget, 0.2)),
    },
  };
}

export async function loadConfig(opts: { path?: string; env?: Env }): Promise<LyktaConfig> {
  const env = opts.env ?? process.env;
  if (env.LYKTA_CONFIG) return parseConfig(env.LYKTA_CONFIG, env);
  const path = env.LYKTA_CONFIG_FILE ?? opts.path ?? "lykta.yaml";
  const file = Bun.file(path);
  if (!(await file.exists()))
    throw new ConfigError([`config file not found: ${path} (use --config or LYKTA_CONFIG)`]);
  return parseConfig(await file.text(), env);
}

/** VAR, or the contents of the file named by VAR_FILE. */
async function secret(env: Env, name: string): Promise<string | undefined> {
  if (env[name]) return env[name];
  const file = env[`${name}_FILE`];
  if (!file) return undefined;
  const f = Bun.file(file);
  if (!(await f.exists()))
    throw new ConfigError([`${name}_FILE points to a missing file: ${file}`]);
  return (await f.text()).trim();
}

export async function loadSecrets(config: LyktaConfig, env: Env = process.env): Promise<Secrets> {
  const problems: string[] = [];
  const tokens: Record<string, string> = {};
  let appId: string | undefined;
  let appPrivateKey: string | undefined;
  const needsApp = Object.values(config.organizations).some((o) => o.auth === "app");
  if (needsApp) {
    appId = await secret(env, "LYKTA_APP_ID");
    appPrivateKey = (await secret(env, "LYKTA_APP_PRIVATE_KEY"))?.replace(/\\n/g, "\n");
    if (!appId)
      problems.push("set LYKTA_APP_ID (the GitHub App's id) for organizations using auth: app");
    if (!appPrivateKey)
      problems.push(
        "set LYKTA_APP_PRIVATE_KEY or LYKTA_APP_PRIVATE_KEY_FILE (the App's private key)",
      );
  }
  for (const [org, o] of Object.entries(config.organizations)) {
    if (o.auth !== "token") continue;
    const t = await secret(env, tokenVar(org));
    if (t) tokens[org] = t;
    else problems.push(`set ${tokenVar(org)} (or ${tokenVar(org)}_FILE) to a token for ${org}`);
  }
  if (problems.length) throw new ConfigError(problems);
  return { appId, appPrivateKey, tokens };
}
