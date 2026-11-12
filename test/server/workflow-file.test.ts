import { describe, expect, test } from "bun:test";
import { buildGraph } from "../../src/core/graph.ts";
import type { JobRecord } from "../../src/core/types.ts";
import { type GhJob, type GhRun, mapRun } from "../../src/server/github/map.ts";
import { attachGraph, parseWorkflow } from "../../src/server/github/workflow-file.ts";

const text = (name: string, file: string) =>
  Bun.file(`test/fixtures/github/${name}/${file}`).text();

async function realJobs(name: string): Promise<JobRecord[]> {
  const run = (await Bun.file(`test/fixtures/github/${name}/run.json`).json()) as GhRun;
  const { jobs } = (await Bun.file(`test/fixtures/github/${name}/jobs.json`).json()) as {
    jobs: GhJob[];
  };
  return mapRun(run, jobs, []).jobs;
}

async function lyktaRelease() {
  const jobs = await realJobs("lykta-release");
  const caller = parseWorkflow(await text("lykta-release", "workflow.yml"));
  const called = {
    "./.github/workflows/ci.yml": parseWorkflow(await text("lykta-release", "called-ci.yml")),
  };
  return attachGraph(jobs, caller, called);
}

const byName = (jobs: JobRecord[], name: string) => jobs.find((j) => j.name === name) as JobRecord;
const idsOf = (jobs: JobRecord[], names: string[]) => names.map((n) => byName(jobs, n).id).sort();

describe("workflow file", () => {
  test("parses needs as string or list", () => {
    const wf = parseWorkflow(`
jobs:
  a: { runs-on: ubuntu-latest, steps: [] }
  b: { needs: a, runs-on: ubuntu-latest }
  c: { needs: [a, b], runs-on: ubuntu-latest }
  d: { uses: ./.github/workflows/x.yml }
  e: { strategy: { matrix: { t: [1, 2] } }, name: "E \${{ matrix.t }}" }
`);
    expect(wf?.jobs.map((j) => [j.id, j.needs])).toEqual([
      ["a", []],
      ["b", ["a"]],
      ["c", ["a", "b"]],
      ["d", []],
      ["e", []],
    ]);
    expect(wf?.jobs.find((j) => j.id === "d")?.uses).toBe("./.github/workflows/x.yml");
    expect(wf?.jobs.find((j) => j.id === "e")?.matrix).toBe(true);
  });

  test("reusable callee jobs need what the caller needs", async () => {
    const jobs = await lyktaRelease();
    const build = byName(jobs, "Build aarch64-apple-darwin");
    expect([...build.needs].sort()).toEqual(
      idsOf(jobs, ["CI / Typecheck", "CI / Lint", "CI / Test", "CI / Build", "Check version"]),
    );
    expect(byName(jobs, "CI / Lint").group).toBe("CI");
  });

  test("filled-in matrix names group together", async () => {
    const jobs = await lyktaRelease();
    expect(
      jobs
        .filter((j) => j.group === "Build")
        .map((j) => j.name)
        .sort(),
    ).toEqual([
      "Build aarch64-apple-darwin",
      "Build x86_64-apple-darwin",
      "Build x86_64-pc-windows-msvc",
      "Build x86_64-unknown-linux-gnu",
    ]);
  });

  test("default matrix names group together", async () => {
    const jobs = attachGraph(
      await realJobs("ailloy-release"),
      parseWorkflow(await text("ailloy-release", "workflow.yml")),
      {},
    );
    const builds = jobs.filter((j) => j.name.startsWith("Build ("));
    expect(builds).toHaveLength(4);
    expect(new Set(builds.map((j) => j.group))).toEqual(new Set(["Build"]));
    expect(byName(jobs, "GitHub Release").needs.sort()).toEqual(builds.map((j) => j.id).sort());
  });

  test("graph builds from real runs", async () => {
    const jobs = await lyktaRelease();
    const g = buildGraph(jobs, 99);
    const colOf = (name: string) =>
      g.columns.findIndex((c) => c.some((n) => n.jobs.some((j) => j.name === name)));
    for (const b of jobs.filter((j) => j.group === "Build")) {
      expect(colOf("GitHub Release")).toBeGreaterThan(colOf(b.name));
    }
  });

  test("unparseable workflow falls back to flat", async () => {
    expect(parseWorkflow("::: not yaml")).toBeNull();
    expect(parseWorkflow("just a string")).toBeNull();
    const jobs = await realJobs("lykta-release");
    expect(attachGraph(jobs, null, {}).every((j) => j.needs.length === 0)).toBe(true);
    const ghost = parseWorkflow("jobs:\n  a: { needs: [ghost] }\n");
    const one: JobRecord[] = [{ ...(jobs[0] as JobRecord), name: "a" }];
    expect(() => attachGraph(one, ghost, {})).not.toThrow();
  });
});
