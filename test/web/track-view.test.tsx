import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { EntryView, JobRecord, RunRecord } from "../../src/core/types.ts";
import { History } from "../../src/web/components/History.tsx";
import { Pit } from "../../src/web/components/Pit.tsx";
import { spotZoom } from "../../src/web/components/RunCard.tsx";
import { Spotlight } from "../../src/web/components/Spotlight.tsx";
import { Track } from "../../src/web/components/Track.tsx";
import { trackLayout } from "../../src/web/track.ts";

const NOW = Date.UTC(2026, 10, 12, 12, 0);
const MIN = 60_000;
const iso = (t: number) => new Date(t).toISOString();

const job = (id: string, status: JobRecord["status"], needs: string[] = []): JobRecord => ({
  id,
  name: id,
  status,
  needs,
  steps: [],
  startedAt: iso(NOW - 10 * MIN),
  completedAt: status === "running" ? null : iso(NOW - MIN),
});

function run(over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 1,
    url: "https://github.com/o/r/actions/runs/1",
    branch: "main",
    sha: "abcdef1",
    actor: "anna",
    event: "push",
    createdAt: iso(NOW - 10 * MIN),
    startedAt: iso(NOW - 10 * MIN),
    completedAt: iso(NOW - MIN),
    status: "completed",
    conclusion: "success",
    jobs: [job("Build", "success"), job("Deploy", "success", ["Build"])],
    ...over,
  };
}

function entry(key: string, over: Partial<EntryView> = {}): EntryView {
  return {
    key,
    name: `Workflow ${key}`,
    repo: "mklab-se/lykta",
    branch: "main",
    state: "passed",
    failing: false,
    history: ["p", "p", "f"],
    latestCompleted: run(),
    ...over,
  };
}

const failedEntry = (key: string) =>
  entry(key, {
    state: "failed",
    failing: true,
    brokenSince: iso(NOW - 75 * MIN),
    latestCompleted: run({
      conclusion: "failure",
      jobs: [job("Build", "failure"), job("Deploy", "skipped", ["Build"])],
    }),
    failure: {
      job: "Build",
      step: "Compile",
      logExcerpt: ["compiling"],
      errors: ["src/a/b/c/Main.java:12: error: cannot find symbol"],
    },
  });

const runningEntry = (key: string, over: Partial<EntryView> = {}) =>
  entry(key, {
    state: "running",
    current: run({
      status: "in_progress",
      conclusion: null,
      completedAt: null,
      jobs: [job("Build", "success"), job("Deploy", "running", ["Build"])],
    }),
    expectedMs: 30 * MIN,
    ...over,
  });

const canvas = { width: 1920, height: 1080 };

describe("track", () => {
  test("every workflow has its slot; one in the pit leaves a gap in its place", () => {
    const entries = ["a", "b", "c", "d", "e", "f"].map((k) => entry(k));
    const layout = trackLayout(6, 1, canvas);
    const html = renderToString(
      <Track entries={entries} pit={new Set(["c"])} layout={layout} now={NOW} onOpen={() => {}} />,
    );
    const slots = html.match(/class="slot[^"]*"/g) ?? [];
    expect(slots).toHaveLength(6);
    expect(slots[2]).toContain("gap");
    expect(html).not.toContain("Workflow c");
    expect(html).toContain("Workflow f");
  });

  test("a running tile glows with its progress; re-running after a failure keeps a red mark", () => {
    const layout = trackLayout(2, 0, canvas);
    const html = renderToString(
      <Track
        entries={[runningEntry("a"), runningEntry("b", { failing: true })]}
        pit={new Set()}
        layout={layout}
        now={NOW}
        onOpen={() => {}}
      />,
    );
    expect(html.match(/class="tile [a-z]+ running/g)).toHaveLength(2);
    expect(html).toContain("10m 00s of ~30m 00s");
    expect(html.match(/class="rerun"/g)).toHaveLength(1);
  });

  test("before the first sync and with nothing configured", () => {
    const layout = trackLayout(0, 0, canvas);
    const props = { pit: new Set<string>(), layout, now: NOW, onOpen: () => {} };
    expect(renderToString(<Track entries={[]} connecting {...props} />)).toContain(
      "Connecting to GitHub",
    );
    expect(renderToString(<Track entries={[]} {...props} />)).toContain("Nothing is monitored yet");
  });
});

describe("labels and colors", () => {
  test("a colored, labelled workflow: its border in its color, #labels in the lower right", () => {
    const layout = trackLayout(2, 0, canvas);
    const html = renderToString(
      <Track
        entries={[entry("a", { labels: ["android", "nightly"], color: "#a78bfa" }), entry("b")]}
        pit={new Set()}
        layout={layout}
        now={NOW}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain("border-color:#a78bfa");
    expect(html).toContain('class="tags"');
    expect(html).toContain("#android");
    expect(html).toContain("#nightly");
    // the plain one looks exactly as before: no tags, no border override
    const plain = renderToString(
      <Track entries={[entry("b")]} pit={new Set()} layout={layout} now={NOW} onOpen={() => {}} />,
    );
    expect(plain).not.toContain('class="tags"');
    expect(plain).not.toContain("border-color");
  });

  test("a car in the pit keeps its labels", () => {
    const layout = trackLayout(6, 1, canvas);
    const html = renderToString(
      <Pit
        entries={[{ ...failedEntry("x"), labels: ["web"], color: "#38bdf8" }]}
        layout={layout}
        now={NOW}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain("#web");
  });
});

describe("history", () => {
  test("always 10 slots: dotted until there are runs, newest on the right", () => {
    const html = renderToString(<History history={["p", "f", "p"]} />);
    expect(html.match(/<i /g)).toHaveLength(10);
    expect(html.match(/class="e"/g)).toHaveLength(7);
    expect(html).toMatch(/class="p latest"[^>]*><\/i><\/div>$/);
  });
});

describe("pit", () => {
  test("a car in the pit: broken for, how far it got, where it broke, the error", () => {
    const layout = trackLayout(6, 1, canvas);
    const html = renderToString(
      <Pit entries={[failedEntry("x")]} layout={layout} now={NOW} onOpen={() => {}} />,
    );
    expect(html).toContain("THE PIT");
    expect(html).toContain("Broken for");
    expect(html).toContain('class="strip');
    expect(html).toContain("Build › Compile");
    expect(html).toContain("…/Main.java:12: error: cannot find symbol");
  });

  test("a lone car uses the whole pit: commit, author and the log leading up to the error", () => {
    const layout = trackLayout(6, 1, canvas);
    const html = renderToString(
      <Pit entries={[failedEntry("x")]} layout={layout} now={NOW} onOpen={() => {}} />,
    );
    expect(html).toContain("abcdef1 · anna");
    expect(html).toContain('class="carlog"');
    expect(html).toContain("compiling");
  });

  test("a missing workflow is in the pit with its problem", () => {
    const layout = trackLayout(6, 1, canvas);
    const html = renderToString(
      <Pit
        entries={[entry("m", { state: "missing", problem: "Workflow x.yml not found (404)" })]}
        layout={layout}
        now={NOW}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain("NOT FOUND");
    expect(html).toContain("not found (404)");
  });

  test("a full pit turns into rows and says how many more", () => {
    const entries = Array.from({ length: 30 }, (_, i) => failedEntry(`f${i}`));
    const layout = trackLayout(40, 30, canvas);
    const html = renderToString(
      <Pit entries={entries} layout={layout} now={NOW} onOpen={() => {}} />,
    );
    expect(html).toContain("pitrow");
    expect(html).toMatch(/\+\d+ more in the pit/);
  });
});

describe("spotlight", () => {
  const props = { width: 1200, height: 800, now: NOW, onOpen: () => {} };

  test("a running workflow: where it is, and how far against the usual time", () => {
    const html = renderToString(<Spotlight e={runningEntry("a")} final={false} {...props} />);
    expect(html).toContain("RUNNING");
    expect(html).toContain("node running");
    expect(html).toContain("of ~30m 00s");
  });

  test("a failed run's last turn: FAILED, the failed job, the error", () => {
    const html = renderToString(<Spotlight e={failedEntry("x")} final {...props} />);
    expect(html).toContain("FAILED");
    expect(html).toContain("node failure");
    expect(html).toContain("cannot find symbol");
    expect(html).toContain("heading to the pit");
  });

  test("a passed run's last turn", () => {
    const html = renderToString(<Spotlight e={entry("p")} final {...props} />);
    expect(html).toContain("PASSED");
    expect(html).not.toContain("heading to the pit");
  });

  test("the diagram scales up only as far as the whole workflow still fits", () => {
    expect(spotZoom(1600, 3)).toBe(1.5); // short workflow: big
    expect(spotZoom(1600, 6)).toBeCloseTo(1600 / (6 * 230 + 60), 2); // longer: just fits
    expect(spotZoom(1600, 12)).toBe(1); // very long: normal size (collapsing as before)
  });
});
