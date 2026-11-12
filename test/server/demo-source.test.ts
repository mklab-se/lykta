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

  test("running jobs list every step, queued ones too", () => {
    const { tick, inputs } = make(14);
    tick();
    const run = inputs().find(
      (i) => i.entry.repo.endsWith("android-platform") && i.runs[0]?.status !== "completed",
    )?.runs[0];
    const build =
      run?.jobs.find((j) => j.group === "Build" && j.status !== "queued") ??
      run?.jobs.find((j) => j.status === "running");
    expect(build?.steps.length).toBeGreaterThan(1);
    expect(build?.steps.some((st) => st.status === "queued" && st.startedAt === null)).toBe(true);
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

  test("a demo failure names its error lines", () => {
    const { tick, inputs } = make(14);
    tick();
    const failing = inputs().filter((x) => x.failure);
    expect(failing.length).toBeGreaterThan(0);
    for (const f of failing) expect(f.failure?.errors?.length).toBeGreaterThan(0);
  });

  test("demo holds are scaled to its fast clock", () => {
    const { src } = make(14);
    expect(src.holdSettings()).toEqual({ clockScale: 60 });
  });

  test("every failed workflow says where and why, including the ones there from the start", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const src = new DemoSource({
        count: 30,
        running: 5,
        seed,
        now: () => Date.UTC(2026, 10, 12, 9, 0),
      });
      let got: EntryInput[] = [];
      src.start((i) => {
        got = i;
      });
      src.stop();
      const failed = got.filter((x) => deriveEntry(x).failing && !x.problem);
      for (const f of failed) expect(f.failure?.job, `seed ${seed}: ${f.entry.name}`).toBeTruthy();
    }
  });
});
