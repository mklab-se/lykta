import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { EntryView, RunRecord } from "../../src/core/types.ts";
import { RunningArea } from "../../src/web/components/RunningArea.tsx";

const NOW = Date.UTC(2026, 10, 12, 12, 0);
const MIN = 60_000;

function running(i: number, elapsedMin: number, expectedMin = 60): EntryView {
  const start = new Date(NOW - elapsedMin * MIN).toISOString();
  const current: RunRecord = {
    id: i,
    url: `https://github.com/o/r${i}/actions/runs/${i}`,
    branch: "main",
    sha: "abcdef1",
    actor: "anna",
    event: "push",
    createdAt: start,
    startedAt: start,
    completedAt: null,
    status: "in_progress",
    conclusion: null,
    jobs: [
      {
        id: "lint",
        name: "Lint",
        status: "success",
        needs: [],
        steps: [],
        startedAt: start,
        completedAt: start,
      },
      {
        id: "build",
        name: "Build · lynx-user",
        status: "running",
        needs: ["lint"],
        runner: { kind: "k8s", label: "arc-aosp-64core", detail: "k8s-build-02" },
        steps: [
          { name: "repo sync -j16", status: "success", startedAt: start, completedAt: start },
          { name: "m -j64", status: "running", startedAt: start, completedAt: null },
        ],
        startedAt: start,
        completedAt: null,
      },
    ],
  };
  return {
    key: `r${i}`,
    name: `Android build ${i}`,
    repo: `mklab-se/android-${i}`,
    branch: "main",
    state: "running",
    failing: false,
    history: [],
    current,
    expectedMs: expectedMin * MIN,
  };
}

const plan = (mode: "single" | "split" | "list", over: Record<string, number> = {}) => ({
  height: 600,
  mode,
  listWidth: 600,
  listColumns: 1,
  rowHeight: 100,
  rowGap: 10,
  hidden: 0,
  graphColumns: 4,
  ...over,
});

describe("RunningArea", () => {
  test("split shows every running workflow", () => {
    const entries = [1, 2, 3, 4, 5].map((i) => running(i, 10));
    const html = renderToString(
      <RunningArea entries={entries} plan={plan("split")} now={NOW} onOpen={() => {}} />,
    );
    expect(html.match(/class="rrow/g)).toHaveLength(5);
    expect(html).toContain("Android build 1");
  });

  test("detail shows progress against expected", () => {
    const html = renderToString(
      <RunningArea
        entries={[running(1, 134, 350)]}
        plan={plan("single")}
        now={NOW}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain("2h 14m of ~5h 50m");
    expect(html).toContain("m -j64");
    expect(html).toContain("K8S");
  });

  test("slow marker shown", () => {
    const html = renderToString(
      <RunningArea
        entries={[running(1, 78, 60)]}
        plan={plan("single")}
        now={NOW}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain("SLOWER THAN USUAL");
    const ok = renderToString(
      <RunningArea
        entries={[running(1, 30, 60)]}
        plan={plan("single")}
        now={NOW}
        onOpen={() => {}}
      />,
    );
    expect(ok).not.toContain("SLOWER THAN USUAL");
  });

  test("dense list: compact rows in columns, overflow summarised", () => {
    const entries = Array.from({ length: 20 }, (_, i) => running(i, 10));
    const html = renderToString(
      <RunningArea
        entries={entries}
        plan={plan("list", {
          listColumns: 3,
          rowHeight: 30,
          rowGap: 4,
          hidden: 5,
          listWidth: 1840,
        })}
        now={NOW}
        onOpen={() => {}}
      />,
    );
    expect(html.match(/class="rrow/g)).toHaveLength(15);
    expect(html).toContain("compact");
    expect(html).toContain("+5 more running");
    expect(html).not.toContain('class="detail"');
  });
});
