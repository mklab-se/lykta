import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { JobRecord, RunRecord } from "../../src/core/types.ts";
import { JobGraph, rowsThatFit } from "../../src/web/components/JobGraph.tsx";

describe("JobGraph", () => {
  test("rowsThatFit: how many nodes stack in the graph's height", () => {
    // 4 parallel jobs of 62 px with 8 px gaps need 272 px
    expect(rowsThatFit(272, 62)).toBe(4);
    expect(rowsThatFit(200, 62)).toBe(2);
    expect(rowsThatFit(40, 62)).toBe(1); // never zero
    expect(rowsThatFit(0, 0)).toBe(Number.POSITIVE_INFINITY); // not measured yet
  });

  test("a column taller than the graph flows into side-by-side sub-columns", () => {
    const job = (id: string): JobRecord => ({
      id,
      name: id,
      status: "success",
      needs: [],
      steps: [],
      startedAt: null,
      completedAt: null,
    });
    const run = {
      id: 1,
      jobs: ["Lint", "Test", "Typecheck", "Build"].map(job),
    } as unknown as RunRecord;
    const html = renderToString(<JobGraph run={run} columns={6} maxRows={2} />);
    expect(html).toContain("grid-template-rows:repeat(2, auto)");
    expect(html).toContain("grid-auto-flow:column");
    // short columns stay as they are
    expect(renderToString(<JobGraph run={run} columns={6} maxRows={4} />)).not.toContain(
      "grid-auto-flow",
    );
  });
});
