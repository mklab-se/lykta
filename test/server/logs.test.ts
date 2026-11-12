import { describe, expect, test } from "bun:test";
import { cleanLog, failureErrors, failureExcerpt } from "../../src/server/github/logs.ts";

const raw = () => Bun.file("test/fixtures/github/lykta-ci-failed/logs-131431121549.txt").text();

describe("logs", () => {
  test("cleans ANSI, BOM and timestamps", async () => {
    const lines = cleanLog(await raw());
    expect(lines[0]).toBe("Current runner version: '2.338.2'");
    expect(lines.some((l) => l.includes("\x1b["))).toBe(false);
    expect(lines.some((l) => /^\d{4}-\d{2}-\d{2}T/.test(l))).toBe(false);
  });

  test("excerpt is the failed step around its error", async () => {
    const ex = failureExcerpt(cleanLog(await raw()), "Run bun run lint");
    expect(ex.length).toBeGreaterThan(0);
    expect(ex.length).toBeLessThanOrEqual(12);
    expect(ex.join("\n")).toContain("Provide an explicit type attribute");
    expect(ex.some((l) => l.startsWith("##["))).toBe(false);
  });

  test("excerpt without an error ends the step", () => {
    const lines = [
      "##[group]Run make",
      "make all",
      "##[endgroup]",
      "step output 1",
      "step output 2",
      "##[group]Run next",
      "x",
    ];
    // the echoed command ("make all") is not output
    expect(failureExcerpt(lines, "Run make")).toEqual(["step output 1", "step output 2"]);
  });

  test("unknown step falls back to the last error in the log", () => {
    const lines = ["a", "##[error]boom", "b"];
    expect(failureExcerpt(lines, "nope")).toContain("boom");
  });

  test("excerpt ends at the error, not at the cleanup after it (real failed run)", async () => {
    const file = [
      ...new Bun.Glob("logs-*.txt").scanSync("test/fixtures/github/live-pipeline-failed"),
    ][0];
    const lines = cleanLog(
      await Bun.file(`test/fixtures/github/live-pipeline-failed/${file}`).text(),
    );
    // GitHub titles a run step's section with its command, not the step name ("Compile")
    const ex = failureExcerpt(lines, "Compile");
    // GitHub's generic closing line says nothing; the real error is what fits on the card
    expect(ex.at(-1)).toBe("Build failed on purpose (fail_at=build)");
    expect(ex.join("\n")).not.toContain("Process completed with exit code");
    expect(ex.join("\n")).toContain("Battery.java:212: error: cannot find symbol");
    expect(ex.join("\n")).not.toContain("Cleaning up orphan processes");
  });

  test("the error lines of a real failed step, without the script that printed them", async () => {
    const file = [
      ...new Bun.Glob("logs-*.txt").scanSync("test/fixtures/github/live-pipeline-failed"),
    ][0];
    const lines = cleanLog(
      await Bun.file(`test/fixtures/github/live-pipeline-failed/${file}`).text(),
    );
    expect(failureErrors(lines, "Compile")).toEqual([
      "frameworks/base/core/java/android/os/Battery.java:212: error: cannot find symbol",
      "Build failed on purpose (fail_at=build)",
    ]);
  });

  test("error lines: the first three distinct, flagged or compiler-style, never the exit line", () => {
    const lines = [
      "##[group]Run make",
      "make",
      "##[endgroup]",
      "compiling a.c",
      "a.c:1: error: one",
      "a.c:2: error: two",
      "warning: fine",
      "FATAL: three",
      "##[error]four",
      "##[error]Process completed with exit code 2.",
    ];
    // the first error is usually the cause; later ones are follow-ups and summaries
    expect(failureErrors(lines, "make")).toEqual([
      "a.c:1: error: one",
      "a.c:2: error: two",
      "FATAL: three",
    ]);
    expect(failureErrors(["all good", "done"], "x")).toEqual([]);
    // Kotlin's compiler marks errors with "e: "
    expect(
      failureErrors(
        ["> Task :app:compileReleaseKotlin", "e: src/Sync.kt:88:17 Unresolved reference: x"],
        "x",
      ),
    ).toEqual(["e: src/Sync.kt:88:17 Unresolved reference: x"]);
    // the same generic line without GitHub's marker (as some tools print it)
    expect(
      failureErrors(["boom: error here", "Error: Process completed with exit code 1."], "x"),
    ).toEqual(["boom: error here"]);
  });

  test("the excerpt is the step's output: not the script GitHub echoes, not blank lines", () => {
    const lines = [
      "##[group]Run make",
      "make -j8",
      'if [ "$X" = 1 ]; then',
      "##[endgroup]",
      "",
      "compiling a.c",
      "a.c:1: error: boom",
      "##[error]Process completed with exit code 2.",
    ];
    expect(failureExcerpt(lines, "make")).toEqual(["compiling a.c", "a.c:1: error: boom"]);
  });
});
