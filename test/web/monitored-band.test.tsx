import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { EntryView } from "../../src/core/types.ts";
import { MonitoredBand } from "../../src/web/components/MonitoredBand.tsx";
import type { MonitoredUnit } from "../../src/web/layout.ts";

const NOW = Date.UTC(2026, 10, 12, 12, 0);

function passed(i: number, over: Partial<EntryView> = {}): EntryView {
  return {
    key: `p${i}`,
    name: `CI ${i}`,
    repo: `mklab-se/repo${i}`,
    branch: "main",
    state: "passed",
    failing: false,
    history: ["p", "p", "f", ...Array(11).fill("p")],
    lastDurationMs: 12 * 60_000,
    latestCompleted: {
      id: i,
      url: "",
      branch: "main",
      sha: "abcdef1234",
      actor: "jonas",
      event: "push",
      createdAt: "",
      startedAt: new Date(NOW - 30 * 60_000).toISOString(),
      completedAt: new Date(NOW - 18 * 60_000).toISOString(),
      status: "completed",
      conclusion: "success",
      jobs: [],
    },
    ...over,
  };
}

const render = (entries: EntryView[], unit: MonitoredUnit = "big", pages = 1, page = 0) =>
  renderToString(
    <MonitoredBand
      entries={entries}
      plan={{ height: 600, unit, columns: 4, rows: 2, pages }}
      page={page}
      now={NOW}
      onOpen={() => {}}
    />,
  );

describe("MonitoredBand", () => {
  test("big tile shows history strip", () => {
    const html = render([passed(1)]);
    expect(html.match(/<i class="(p|f)"/g)).toHaveLength(14);
    expect(html.match(/<i class="f"/g)).toHaveLength(1);
    expect(html).toContain("PASSED");
    expect(html).toContain("18 min ago");
    expect(html).toContain("took 12m 00s");
    expect(html).toContain("abcdef1");
  });

  test("never run tile", () => {
    const html = render([passed(1, { state: "never", history: [], latestCompleted: undefined })]);
    expect(html).toContain("NEVER RUN");
  });

  test("page dots", () => {
    const html = render(
      Array.from({ length: 20 }, (_, i) => passed(i)),
      "tiny",
      3,
      1,
    );
    expect(
      html.match(/<i class="(on)?"/g)?.length ?? html.match(/class="pager"/g)?.length,
    ).toBeTruthy();
    expect(html.match(/<i class="on"/g)).toHaveLength(1);
    expect(html.match(/<i class=""/g)).toHaveLength(2);
  });

  test("renders empty message", () => {
    const html = render([]);
    expect(html).toContain("Nothing is monitored yet");
  });
});
