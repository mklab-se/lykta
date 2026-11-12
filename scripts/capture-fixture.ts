#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
/**
 * Dev tool: saves a real workflow run as a test fixture, using the developer's own `gh` login
 * (nothing is stored but public run data; tokens never touch the files).
 *
 *   bun scripts/capture-fixture.ts <owner/repo> <runId> <fixtureName>
 *
 * Writes test/fixtures/github/<fixtureName>/: run.json, jobs.json (all pages, latest attempt),
 * the workflow file at the run's commit plus every referenced (reusable) workflow, and for each
 * failed job logs-<jobId>.txt and annotations-<jobId>.json.
 */
import { $ } from "bun";

const [repo, runId, name] = process.argv.slice(2);
if (!repo || !runId || !name) {
  console.error("usage: bun scripts/capture-fixture.ts <owner/repo> <runId> <fixtureName>");
  process.exit(2);
}
const dir = join("test/fixtures/github", name);
await mkdir(dir, { recursive: true });

const api = async (path: string) => JSON.parse(await $`gh api ${path}`.quiet().text());
const save = (file: string, data: unknown) =>
  Bun.write(
    join(dir, file),
    typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`,
  );

const run = await api(`repos/${repo}/actions/runs/${runId}`);
await save("run.json", run);

const jobs: unknown[] = [];
for (let page = 1; ; page++) {
  const res = await api(
    `repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100&page=${page}`,
  );
  jobs.push(...res.jobs);
  if (jobs.length >= res.total_count || res.jobs.length === 0) break;
}
await save("jobs.json", { total_count: jobs.length, jobs });

const workflowFile = async (fullRepo: string, path: string, ref: string, out: string) => {
  const content = await api(`repos/${fullRepo}/contents/${path}?ref=${ref}`);
  await save(out, Buffer.from(content.content, "base64").toString("utf8"));
};
await workflowFile(repo, run.path, run.head_sha, "workflow.yml");
for (const ref of run.referenced_workflows ?? []) {
  // "owner/repo/.github/workflows/x.yml@sha"
  const [where] = ref.path.split("@");
  const [owner, r, ...rest] = where.split("/");
  await workflowFile(`${owner}/${r}`, rest.join("/"), ref.sha, `called-${rest.at(-1)}`);
}

for (const job of jobs as { id: number; conclusion: string | null }[]) {
  if (job.conclusion !== "failure") continue;
  const logs = await $`gh api --allow-escape-sequences repos/${repo}/actions/jobs/${job.id}/logs`
    .quiet()
    .text();
  await save(`logs-${job.id}.txt`, logs);
  await save(
    `annotations-${job.id}.json`,
    await api(`repos/${repo}/check-runs/${job.id}/annotations`),
  );
}
console.log(`saved ${dir}: ${jobs.length} jobs`);
