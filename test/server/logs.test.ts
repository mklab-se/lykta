import { describe, expect, test } from "bun:test";
import { cleanLog, failureExcerpt } from "../../src/server/github/logs.ts";

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
    expect(failureExcerpt(lines, "Run make")).toEqual([
      "make all",
      "step output 1",
      "step output 2",
    ]);
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
    expect(ex.at(-1)).toBe("Process completed with exit code 1.");
    expect(ex.join("\n")).toContain("Battery.java:212: error: cannot find symbol");
    expect(ex.join("\n")).not.toContain("Cleaning up orphan processes");
  });
});
