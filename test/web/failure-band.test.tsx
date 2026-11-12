import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { EntryView } from "../../src/core/types.ts";
import { FailureBand } from "../../src/web/components/FailureBand.tsx";

const NOW = Date.UTC(2026, 10, 12, 12, 0);

function failed(over: Partial<EntryView> = {}): EntryView {
  return {
    key: "e1",
    name: "Nightly build",
    repo: "mklab-se/android-platform",
    branch: "main",
    state: "failed",
    failing: true,
    history: [],
    brokenSince: new Date(NOW - (3 * 60 + 12) * 60_000).toISOString(),
    failure: {
      job: "Build · lynx-user",
      step: "m -j64",
      runner: { kind: "k8s", label: "arc-aosp-64core", detail: "k8s-build-03" },
      logExcerpt: [
        "ninja: build stopped: subcommand failed.",
        "#### failed to build some targets ####",
      ],
    },
    latestCompleted: {
      id: 1,
      url: "https://github.com/x/actions/runs/1",
      branch: "main",
      sha: "abc1234",
      actor: "anna",
      event: "push",
      createdAt: "",
      startedAt: null,
      completedAt: null,
      status: "completed",
      conclusion: "failure",
      jobs: [],
    },
    ...over,
  };
}

const render = (entries: EntryView[], mode: "card" | "small" | "row" = "card") =>
  renderToString(
    <FailureBand
      entries={entries}
      plan={{ mode, columns: 3, rows: Math.ceil(entries.length / 3), height: 320 }}
      now={NOW}
      onOpen={() => {}}
    />,
  );

describe("FailureBand", () => {
  test("card shows broken for and failing step", () => {
    const html = render([failed()]);
    expect(html).toContain("Broken for <!-- -->3h 12m");
    expect(html).toContain("Build · lynx-user");
    expect(html).toContain("m -j64");
    expect(html).toContain("K8S");
    expect(html).toContain("ninja: build stopped");
  });

  test("missing shows not found", () => {
    const html = render([
      failed({
        state: "missing",
        failing: false,
        problem: "Workflow nightly.yml not found (404)",
        failure: undefined,
      }),
    ]);
    expect(html).toContain("NOT FOUND");
    expect(html).toContain("not found (404)");
    // the configured name leads, so two missing workflows in one repo can be told apart
    expect(html).toMatch(/class="name ellipsis">Nightly build</);
  });

  test("small mode drops the log", () => {
    expect(render([failed()], "small")).not.toContain("ninja: build stopped");
  });

  test("row mode renders rows", () => {
    const html = render([failed(), failed({ key: "e2" })], "row");
    expect(html.match(/class="failrow/g)).toHaveLength(2);
  });

  test("long names are truncated with ellipsis class", () => {
    const html = render([failed({ name: "N".repeat(200) })]);
    expect(html).toMatch(/class="name ellipsis"[^>]*>N{200}/);
  });

  const pipeline = (): NonNullable<EntryView["latestCompleted"]> => {
    const job = (id: string, status: "success" | "failure" | "skipped", needs: string[] = []) => ({
      id,
      name: id,
      status,
      needs,
      steps: [],
      startedAt: null,
      completedAt: null,
    });
    return {
      ...(failed().latestCompleted as NonNullable<EntryView["latestCompleted"]>),
      jobs: [
        job("Prepare", "success"),
        job("Build", "failure", ["Prepare"]),
        job("Checks", "skipped", ["Build"]),
        job("Deploy", "skipped", ["Checks"]),
      ],
    };
  };

  test("card shows how far the run got: passed, failed and never-run stages", () => {
    const html = render([failed({ latestCompleted: pipeline() })]);
    expect(html).toContain('class="strip');
    expect(html.match(/class="seg success/g)).toHaveLength(1);
    expect(html.match(/class="seg failure/g)).toHaveLength(1);
    expect(html.match(/class="seg skipped/g)).toHaveLength(2);
  });

  test("the error message is the card's biggest text", () => {
    const e = failed({
      latestCompleted: pipeline(),
      failure: {
        ...(failed().failure as NonNullable<EntryView["failure"]>),
        errors: ["Battery.java:212: error: cannot find symbol"],
      },
    });
    const html = render([e]);
    expect(html).toContain('class="errline"');
    expect(html).toContain("Battery.java:212: error: cannot find symbol");
    expect(render([e], "small")).toContain("Battery.java:212: error: cannot find symbol");
    // the log behind it is in the detail view; on the card it would only be a clipped sliver
    expect(html).not.toContain("ninja: build stopped");
  });

  test("no error line: the card says why the job ended", () => {
    const e = failed({
      failure: {
        ...(failed().failure as NonNullable<EntryView["failure"]>),
        errors: [],
        reason: "The job timed out",
      },
    });
    expect(render([e])).toContain("The job timed out");
  });

  test("rows show the strip too", () => {
    expect(render([failed({ latestCompleted: pipeline() })], "row")).toContain('class="strip');
  });

  test("a short card keeps the error: broken-for moves up, repo and runner go", () => {
    const e = failed({
      failure: {
        ...(failed().failure as NonNullable<EntryView["failure"]>),
        errors: [
          "UPGRADE FAILED: timed out waiting for the condition",
          "Deploy failed on purpose (fail=true)",
        ],
      },
    });
    const html = renderToString(
      <FailureBand
        entries={[e]}
        plan={{ mode: "card", columns: 2, rows: 1, height: 230 }}
        now={NOW}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain("UPGRADE FAILED");
    expect(html).toContain('class="brokentag"');
    // one error line: the first, which names the cause; a second would be cut in half
    expect(html).not.toContain("Deploy failed on purpose");
    expect(html).not.toContain("mklab-se/android-platform · main");
    expect(html).not.toContain("K8S");
  });
});
