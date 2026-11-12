import { describe, expect, test } from "bun:test";
import { buildGraph, jobDepths } from "../../src/core/graph.ts";
import type { JobRecord, JobStatus } from "../../src/core/types.ts";

const job = (
  id: string,
  needs: string[] = [],
  status: JobStatus = "queued",
  group?: string,
): JobRecord => ({
  id,
  name: id,
  status,
  needs,
  group,
  steps: [],
  startedAt: null,
  completedAt: null,
});

describe("buildGraph", () => {
  test("columns follow needs", () => {
    const g = buildGraph([job("a"), job("b", ["a"]), job("c", ["a"]), job("d", ["b", "c"])], 10);
    expect(g.columns.map((c) => c.map((n) => n.id))).toEqual([["a"], ["b", "c"], ["d"]]);
  });

  test("matrix folds above 3", () => {
    const four = ["l", "m", "n", "o"].map((id) => job(id, [], "queued", "Build"));
    const g = buildGraph(four, 10);
    expect(g.columns[0]).toHaveLength(1);
    expect(g.columns[0]?.[0]?.label).toBe("Build ×4");
    expect(g.columns[0]?.[0]?.kind).toBe("group");
    expect(g.columns[0]?.[0]?.jobs).toHaveLength(4);
    const three = buildGraph(
      ["l", "m", "n"].map((id) => job(id, [], "queued", "Build")),
      10,
    );
    expect(three.columns[0]).toHaveLength(3);
  });

  test("group status", () => {
    const failed = buildGraph(
      [
        job("a", [], "failure", "B"),
        job("b", [], "success", "B"),
        job("c", [], "success", "B"),
        job("d", [], "success", "B"),
      ],
      10,
    );
    expect(failed.columns[0]?.[0]?.status).toBe("failure");
    const mixed = buildGraph(
      [
        job("a", [], "success", "B"),
        job("b", [], "success", "B"),
        job("c", [], "queued", "B"),
        job("d", [], "queued", "B"),
      ],
      10,
    );
    expect(mixed.columns[0]?.[0]?.status).toBe("running");
  });

  test("collapses finished columns", () => {
    const jobs: JobRecord[] = [];
    for (let i = 0; i < 8; i++)
      jobs.push(job(`j${i}`, i ? [`j${i - 1}`] : [], i < 5 ? "success" : "queued"));
    const g = buildGraph(jobs, 4);
    expect(g.columns.length).toBeLessThanOrEqual(4);
    const first = g.columns[0]?.[0];
    expect(first?.kind).toBe("done");
    expect(first?.label).toBe(`${first?.jobs.length} jobs done`);
    expect(g.columns.at(-1)?.[0]?.kind).toBe("later");
    expect(g.columns.at(-1)?.[0]?.label).toMatch(/^\+\d+ jobs$/);
  });

  test("edges between nodes deduplicated", () => {
    const builds = ["w", "x", "y", "z"].map((id) => job(id, ["lint"], "queued", "Build"));
    const g = buildGraph([job("lint"), ...builds], 10);
    expect(g.edges).toEqual([["lint", "g-Build"]]);
  });

  test("missing need and cycle fall back to depth 0", () => {
    const ghost = buildGraph([job("a", ["ghost"])], 10);
    expect(ghost.columns[0]?.[0]?.id).toBe("a");
    expect(ghost.edges).toEqual([]);
    const d = jobDepths([job("a", ["b"]), job("b", ["a"])]);
    expect([...d.keys()].sort()).toEqual(["a", "b"]);
    expect(buildGraph([job("a", ["b"]), job("b", ["a"])], 10).columns.flat()).toHaveLength(2);
  });
});
