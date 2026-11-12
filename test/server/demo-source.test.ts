import { describe, expect, test } from "bun:test";
import { deriveEntry } from "../../src/core/state.ts";
import type { EntryInput } from "../../src/core/types.ts";
import { DemoSource } from "../../src/server/demo-source.ts";

function make(count = 14, running = 2) {
  let t = Date.UTC(2026, 10, 12, 9, 0);
  const src = new DemoSource({ count, running, seed: 42, now: () => t, tickMs: 1000, speed: 60 });
  let last: EntryInput[] = [];
  src.start((inputs) => {
    last = inputs;
  });
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      t += 1000;
      src.tick();
    }
  };
  src.stop(); // tests drive ticks by hand
  return { src, tick, inputs: () => last };
}

const runningCount = (inputs: EntryInput[]) =>
  inputs.filter((i) => i.runs[0] && i.runs[0].status !== "completed").length;

describe("DemoSource", () => {
  test("seeds count entries", () => {
    const { tick, inputs } = make(14);
    tick();
    expect(inputs()).toHaveLength(14);
  });

  test("keeps running target", () => {
    const { tick, inputs } = make(30, 5);
    for (let i = 0; i < 50; i++) {
      tick();
      expect(runningCount(inputs())).toBe(5);
    }
  });

  test("runs respect needs", () => {
    const { tick, inputs } = make(20, 6);
    for (let i = 0; i < 200; i++) {
      tick();
      for (const input of inputs()) {
        const run = input.runs[0];
        if (!run || run.status === "completed") continue;
        for (const j of run.jobs) {
          if (j.status !== "running") continue;
          for (const n of j.needs) expect(run.jobs.find((x) => x.id === n)?.status).toBe("success");
        }
      }
    }
  });

  test("android pipeline groups", () => {
    const { tick, inputs } = make(14);
    tick();
    const android = inputs().find((i) => i.entry.repo.endsWith("android-platform"));
    const run = android?.runs[0];
    expect(run?.jobs.filter((j) => j.group === "Build")).toHaveLength(4);
  });

  test("breakOne makes a failure", () => {
    const { src, tick, inputs } = make(14);
    tick();
    const before = inputs()
      .map(deriveEntry)
      .filter((e) => e.state === "failed").length;
    src.breakOne();
    tick();
    const after = inputs()
      .map(deriveEntry)
      .filter((e) => e.state === "failed").length;
    expect(after).toBeGreaterThanOrEqual(before + 1);
  });

  test("no test wording", () => {
    const { tick, inputs } = make(40, 8);
    tick(30);
    for (const i of inputs()) {
      for (const r of i.runs)
        for (const j of r.jobs) expect(j.name).not.toMatch(/unit test|shard/i);
      for (const l of i.failure?.logExcerpt ?? []) expect(l).not.toMatch(/unit test|shard/i);
    }
  });

  test("details for a failed entry has a log excerpt", async () => {
    const { src, tick, inputs } = make(14);
    tick();
    const failed = inputs().find((i) => deriveEntry(i).state === "failed");
    const d = await src.details(failed?.entry.key ?? "");
    expect(d?.logExcerpt.length).toBeGreaterThan(0);
    expect(d?.runUrl).toContain("/actions/runs/");
    expect(await src.details("nope")).toBeNull();
  });
});
