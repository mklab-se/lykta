import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { EntryView, JobRecord } from "../../src/core/types.ts";
import { FailureWhat, shortenPaths } from "../../src/web/components/FailureWhat.tsx";
import { ProgressStrip } from "../../src/web/components/ProgressStrip.tsx";
import { singleRepo } from "../../src/web/track.ts";

describe("error lines", () => {
  test("long file paths keep only the file, so the error itself fits", () => {
    expect(
      shortenPaths(
        "frameworks/base/core/java/android/os/Battery.java:212: error: cannot find symbol",
      ),
    ).toBe("…/Battery.java:212: error: cannot find symbol");
    expect(shortenPaths("src/sync.ts(88,17): error TS2304")).toBe(
      "src/sync.ts(88,17): error TS2304",
    );
    expect(shortenPaths("see https://example.com/a/b/c/d for details")).toBe(
      "see https://example.com/a/b/c/d for details",
    );
  });

  test("the card shows the shortened line", () => {
    const e = {
      key: "k",
      failure: {
        job: "Build",
        step: "Compile",
        logExcerpt: [],
        errors: ["frameworks/base/core/java/android/os/Battery.java:212: error: x"],
      },
    } as unknown as EntryView;
    expect(renderToString(<FailureWhat e={e} />)).toContain("…/Battery.java:212: error: x");
  });
});

describe("strip", () => {
  const job = (id: string, status: JobRecord["status"], needs: string[] = []): JobRecord => ({
    id,
    name: id,
    status,
    needs,
    steps: [],
    startedAt: null,
    completedAt: null,
  });

  test("parallel jobs sit side by side; with many, only the failed one is labelled", () => {
    const jobs = [
      job("Licenses", "success"),
      job("Secrets", "success"),
      job("Containers", "success"),
      job("Dependencies", "failure"),
      job("Summary", "skipped", ["Licenses", "Secrets", "Containers", "Dependencies"]),
    ];
    const html = renderToString(<ProgressStrip jobs={jobs} labels />);
    expect(html).toContain('class="stage multi"');
    expect(html).toContain("Dependencies");
    expect(html).not.toContain("Licenses");
    expect(html).toContain("Summary");
  });

  test("two parallel jobs keep their labels", () => {
    const jobs = [
      job("Build", "success"),
      job("Checks", "skipped", ["Build"]),
      job("Long", "skipped", ["Build"]),
    ];
    const html = renderToString(<ProgressStrip jobs={jobs} labels />);
    expect(html).toContain("Checks");
    expect(html).toContain("Long");
  });
});

describe("repository names", () => {
  test("one repository for everything: no need to repeat it", () => {
    const e = (repo: string) => ({ repo }) as EntryView;
    expect(singleRepo([e("o/a"), e("o/a")])).toBe(true);
    expect(singleRepo([e("o/a"), e("o/b")])).toBe(false);
    expect(singleRepo([])).toBe(false);
  });
});
