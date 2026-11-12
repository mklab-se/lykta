import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { EntryView } from "../../src/core/types.ts";
import type { RunDetails } from "../../src/server/source.ts";
import { DetailOverlay } from "../../src/web/components/DetailOverlay.tsx";

const NOW = Date.UTC(2026, 10, 12, 12, 0);
const url = "https://github.com/mklab-se/x/actions/runs/42";

const base: EntryView = {
  key: "e1",
  name: "Nightly build",
  repo: "mklab-se/android-platform",
  branch: "main",
  state: "passed",
  failing: false,
  history: ["p", "p"],
  lastDurationMs: 600_000,
  latestCompleted: {
    id: 42,
    url,
    branch: "main",
    sha: "abcdef1",
    actor: "anna",
    event: "push",
    createdAt: "",
    startedAt: new Date(NOW - 3_600_000).toISOString(),
    completedAt: new Date(NOW - 3_000_000).toISOString(),
    status: "completed",
    conclusion: "success",
    jobs: [],
  },
};

const details = (log: string[]): RunDetails => ({
  entryKey: "e1",
  runUrl: url,
  logExcerpt: log,
  jobs: [
    {
      id: "a",
      name: "Build",
      status: "success",
      needs: [],
      steps: [],
      startedAt: new Date(NOW - 3_600_000).toISOString(),
      completedAt: new Date(NOW - 3_300_000).toISOString(),
    },
    {
      id: "b",
      name: "Publish OTA",
      status: "skipped",
      needs: ["a"],
      steps: [],
      startedAt: null,
      completedAt: null,
    },
  ],
});

const render = (e: EntryView, d: RunDetails | null) =>
  renderToString(
    <DetailOverlay entry={e} details={d} now={NOW} countdown={null} onClose={() => {}} />,
  );

describe("DetailOverlay", () => {
  test("overlay shows QR svg for run url", () => {
    const html = render(base, details(["Post job cleanup."]));
    expect(html).toContain("<svg");
    expect(html).toContain("Open on your phone");
  });

  test("passed overlay has no failure wording", () => {
    const html = render(
      base,
      details(["Artifact upload complete", "Post job cleanup."]),
    ).toLowerCase();
    expect(html).not.toContain("failed");
    expect(html).not.toContain("error");
    expect(html).toContain("passed");
  });

  test("failed overlay shows failing step, skipped jobs and log", () => {
    const failed: EntryView = {
      ...base,
      state: "failed",
      failing: true,
      brokenSince: new Date(NOW - 7_200_000).toISOString(),
      failure: {
        job: "Build",
        step: "m -j64",
        logExcerpt: ["ninja: build stopped: subcommand failed."],
      },
    };
    const html = render(failed, details(["ninja: build stopped: subcommand failed."]));
    expect(html).toContain("m -j64");
    expect(html).toContain("Publish OTA");
    expect(html).toContain("ninja: build stopped");
    expect(html).toContain("2h 00m");
  });
});
