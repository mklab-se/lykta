import { describe, expect, test } from "bun:test";
import type { DashboardState, EntryState, EntryView } from "../../src/core/types.ts";
import { computeLayout } from "../../src/web/layout.ts";

const screen = { width: 1920, height: 1080 };

function state(counts: Partial<Record<EntryState, number>>): DashboardState {
  const entries: EntryView[] = [];
  for (const [s, n] of Object.entries(counts) as [EntryState, number][]) {
    for (let i = 0; i < n; i++) {
      entries.push({
        key: `${s}${i}`,
        name: `${s} ${i}`,
        repo: "o/r",
        branch: "main",
        state: s,
        failing: s === "failed",
        history: [],
      });
    }
  }
  return { version: "1", generatedAt: "", entries, warnings: [] };
}

describe("computeLayout", () => {
  test("calm screen uses big tiles", () => {
    const p = computeLayout(state({ passed: 10 }), screen, 0);
    expect(p.running).toBeNull();
    expect(p.failures).toBeNull();
    expect(p.monitored.unit).toBe("big");
    expect(p.monitored.pages).toBe(1);
  });

  test("busy screen shrinks monitored", () => {
    const p = computeLayout(state({ running: 12, passed: 28 }), screen, 12);
    expect(p.running?.mode).toBe("split");
    expect(["cell", "tiny"]).toContain(p.monitored.unit);
    expect(p.running?.rowHeight).toBeGreaterThanOrEqual(44);
    expect(p.running?.rowHeight).toBeLessThanOrEqual(120);
  });

  test("one run is single", () => {
    expect(computeLayout(state({ running: 1, passed: 5 }), screen, 1).running?.mode).toBe("single");
  });

  test("few failures are cards", () => {
    const p = computeLayout(state({ failed: 2, passed: 5 }), screen, 0);
    expect(p.failures?.mode).toBe("card");
    expect(p.failures?.height).toBe(320);
    expect(computeLayout(state({ failed: 2, running: 6 }), screen, 6).failures?.height).toBe(230);
  });

  test("many failures become rows", () => {
    const p = computeLayout(state({ failed: 9, passed: 5 }), screen, 0);
    expect(p.failures?.mode).toBe("row");
    expect(p.failures?.columns).toBe(3);
  });

  test("failures never dropped", () => {
    const p = computeLayout(state({ failed: 30, running: 6, passed: 10 }), screen, 6);
    expect((p.failures?.rows ?? 0) * (p.failures?.columns ?? 0)).toBeGreaterThanOrEqual(30);
    expect(p.failures?.height).toBeLessThanOrEqual(300);
  });

  test("paging", () => {
    const p = computeLayout(state({ passed: 100, running: 12 }), screen, 12);
    expect(p.monitored.unit).toBe("tiny");
    expect(p.monitored.pages).toBeGreaterThan(1);
  });

  test("bands fit the screen", () => {
    const p = computeLayout(state({ failed: 3, running: 5, passed: 30 }), screen, 5);
    const used =
      (p.failures ? p.failures.height + 28 + 18 : 0) +
      (p.running ? p.running.height + 28 + 18 : 0) +
      p.monitored.height;
    expect(used).toBeLessThanOrEqual(1080 - 80 - 30);
  });

  test("empty state layout", () => {
    expect(computeLayout(state({}), screen, 0).empty).toBe(true);
  });
});
