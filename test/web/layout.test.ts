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
    expect(computeLayout(state({ failed: 2, running: 1 }), screen, 1).failures?.height).toBe(320);
    expect(computeLayout(state({ failed: 2, running: 6 }), screen, 6).failures?.height).toBe(230);
  });

  test("a calm wall gives failure cards room for their log lines", () => {
    // measured on the real wall: a failure card with 4 log lines needs about 430 px
    const p = computeLayout(state({ failed: 1, passed: 2 }), screen, 0);
    expect(p.failures?.mode).toBe("card");
    expect(p.failures?.height).toBeGreaterThanOrEqual(430);
    expect(p.monitored.height).toBeGreaterThan(300);
  });

  test("many failures become rows", () => {
    const p = computeLayout(state({ failed: 9, passed: 5 }), screen, 0);
    expect(p.failures?.mode).toBe("row");
    expect(p.failures?.columns).toBe(3);
  });

  test("failures never dropped", () => {
    const p = computeLayout(state({ failed: 30, running: 6, passed: 10 }), screen, 6);
    expect((p.failures?.rows ?? 0) * (p.failures?.columns ?? 0)).toBeGreaterThanOrEqual(30);
    expect(p.failures?.height).toBeLessThanOrEqual(Math.round(0.45 * (1080 - 80 - 30)));
  });

  test("paging", () => {
    const p = computeLayout(state({ passed: 100, running: 12 }), screen, 12);
    expect(p.monitored.unit).toBe("tiny");
    expect(p.monitored.pages).toBeGreaterThan(1);
  });

  test("running and failures always fit, across screens and loads", () => {
    const sizes = [
      { width: 1920, height: 1080 },
      { width: 1920, height: 810 },
      { width: 1920, height: 1200 },
      { width: 1920, height: 540 },
    ];
    for (const size of sizes) {
      for (const f of [0, 1, 3, 7, 30]) {
        for (const r of [0, 1, 2, 5, 12, 20, 50]) {
          const p = computeLayout(state({ failed: f, running: r, passed: 20 }), size, r);
          const H = size.height - 80 - 30;
          const heights = [p.failures?.height ?? 0, p.running?.height ?? 0, p.monitored.height];
          for (const h of heights) expect(h).toBeGreaterThanOrEqual(0);
          const used =
            (p.failures ? p.failures.height + 28 + 18 : 0) +
            (p.running ? p.running.height + 28 + 18 : 0) +
            p.monitored.height;
          expect(used).toBeLessThanOrEqual(H);
          if (p.failures) expect(p.failures.rows * p.failures.columns).toBeGreaterThanOrEqual(f);
          if (r > 0 && p.running) {
            const rr = p.running;
            if (rr.mode !== "single") {
              const perCol = Math.ceil((r - rr.hidden) / rr.listColumns);
              expect(perCol * rr.rowHeight + (perCol - 1) * rr.rowGap).toBeLessThanOrEqual(
                rr.height,
              );
            } else {
              expect(rr.height).toBeGreaterThanOrEqual(260);
            }
            // on ordinary screens nothing that runs is ever hidden
            if (size.height >= 810 && f <= 7 && r <= 20) expect(rr.hidden).toBe(0);
          }
        }
      }
    }
  });

  test("many failures stay readable (at most 4 columns on 1080p)", () => {
    const p = computeLayout(state({ failed: 30, passed: 5 }), screen, 0);
    expect(p.failures?.columns).toBeLessThanOrEqual(4);
  });

  test("empty state layout", () => {
    expect(computeLayout(state({}), screen, 0).empty).toBe(true);
  });

  test("held runs take running space, not failure or monitored space", () => {
    const st = state({ failed: 2, passed: 3 });
    const held = new Set(["failed0", "passed0"]);
    const p = computeLayout(st, screen, 2, held);
    expect(p.failures?.columns).toBe(1); // only failed1 is in the band
    expect(p.running).not.toBeNull();
    expect(p.monitored.columns * p.monitored.rows).toBeGreaterThanOrEqual(2);
    // nothing held: both failures are cards in the band
    expect(computeLayout(st, screen, 0).failures?.columns).toBe(2);
  });
});
