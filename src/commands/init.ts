/**
 * `lykta init`: asks a few questions and writes a starter lykta.yaml. Never writes secrets;
 * prints the environment variables to set instead.
 */
import { createInterface } from "node:readline/promises";
import { tokenVar } from "../server/config.ts";
import { API, apiHeaders } from "../server/github/auth.ts";

export interface InitAnswers {
  title?: string;
  orgs: { name: string; auth: "app" | "token" }[];
  monitor: { repo: string; workflow: string; branch?: string }[];
}

const q = (s: string) => (/^[\w./-]+$/.test(s) ? s : JSON.stringify(s));

export function buildConfigYaml(a: InitAnswers): string {
  const lines = [
    "# Lykta configuration (written by lykta init). Secrets are not stored here:",
    "# set the environment variables lykta init printed.",
    "",
  ];
  if (a.title) lines.push(`title: ${q(a.title)}`, "");
  lines.push("defaults:", "  branch: main", "", "organizations:");
  for (const o of a.orgs) lines.push(`  ${q(o.name)}:`, `    auth: ${o.auth}`);
  lines.push("", "# One entry = one tile.", "monitor:");
  for (const m of a.monitor) {
    lines.push(`  - repo: ${q(m.repo)}`, `    workflow: ${q(m.workflow)}`);
    if (m.branch && m.branch !== "main") lines.push(`    branch: ${q(m.branch)}`);
  }
  return `${lines.join("\n")}\n`;
}

export function envVarsFor(a: InitAnswers): string[] {
  const vars: string[] = [];
  if (a.orgs.some((o) => o.auth === "app"))
    vars.push("LYKTA_APP_ID", "LYKTA_APP_PRIVATE_KEY (or LYKTA_APP_PRIVATE_KEY_FILE)");
  for (const o of a.orgs)
    if (o.auth === "token") vars.push(`${tokenVar(o.name)} (or ${tokenVar(o.name)}_FILE)`);
  return vars;
}

async function listWorkflows(repo: string, token: string): Promise<string[]> {
  try {
    const res = await fetch(`${API}/repos/${repo}/actions/workflows?per_page=100`, {
      headers: apiHeaders(token),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { workflows: { path: string }[] };
    return body.workflows.map((w) => w.path.split("/").at(-1) ?? w.path);
  } catch {
    return [];
  }
}

export async function runInit(opts: { output: string; force?: boolean }): Promise<void> {
  if ((await Bun.file(opts.output).exists()) && !opts.force) {
    console.error(`${opts.output} already exists (use --force to overwrite)`);
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (question: string) => (await rl.question(question)).trim();
  const answers: InitAnswers = { orgs: [], monitor: [] };
  answers.title = (await ask("Dashboard title (optional): ")) || undefined;
  for (;;) {
    const name = await ask("GitHub organization or user (empty when done): ");
    if (!name) break;
    const auth =
      (await ask("  Sign in with a GitHub App or a token? [app/token] (token): ")) === "app"
        ? "app"
        : "token";
    answers.orgs.push({ name, auth });
  }
  for (;;) {
    const repo = await ask("Repository to monitor, owner/name (empty when done): ");
    if (!repo) break;
    const owner = repo.split("/")[0] ?? "";
    const token = process.env[tokenVar(owner)];
    const found = token ? await listWorkflows(repo, token) : [];
    for (const [i, w] of found.entries()) console.log(`  ${i + 1}. ${w}`);
    for (;;) {
      const pick = await ask(
        found.length
          ? "  Workflow number or file name (empty when done): "
          : "  Workflow file, e.g. ci.yml (empty when done): ",
      );
      if (!pick) break;
      const workflow = found[Number.parseInt(pick, 10) - 1] ?? pick;
      const branch = (await ask("    Branch (main): ")) || "main";
      answers.monitor.push({ repo, workflow, branch });
    }
    if (!answers.orgs.some((o) => o.name === owner))
      answers.orgs.push({ name: owner, auth: "token" });
  }
  rl.close();
  await Bun.write(opts.output, buildConfigYaml(answers));
  console.log(
    `\nWrote ${opts.output}. Set these environment variables before lykta serve or lykta check:`,
  );
  for (const v of envVarsFor(answers)) console.log(`  ${v}`);
}
