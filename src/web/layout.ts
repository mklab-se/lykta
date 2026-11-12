/**
 * Decides how the screen is shared between the three bands, and how dense each one is
 * (spec section 3.2). Pure, so it is tested without a browser.
 */
import type { DashboardState, EntryView } from "../core/types.ts";

export const HEADER = 80;
export const SIDE = 40;
export const BOTTOM = 30;
export const LABEL = 28;
export const GAP = 18;
export const LIST_WIDTH = 600;

export type MonitoredUnit = "big" | "mid" | "chip" | "cell" | "tiny";

export const UNITS: { unit: MonitoredUnit; w: number; h: number }[] = [
  { unit: "big", w: 430, h: 200 },
  { unit: "mid", w: 340, h: 120 },
  { unit: "chip", w: 300, h: 76 },
  { unit: "cell", w: 230, h: 44 },
  { unit: "tiny", w: 180, h: 36 },
];

export interface LayoutPlan {
  empty: boolean;
  failures: {
    height: number;
    mode: "card" | "small" | "row";
    columns: number;
    rows: number;
  } | null;
  running: {
    height: number;
    mode: "single" | "split";
    listWidth: typeof LIST_WIDTH;
    rowHeight: number;
    graphColumns: number;
  } | null;
  monitored: { height: number; unit: MonitoredUnit; columns: number; rows: number; pages: number };
}

export const isFailingEntry = (e: EntryView) => e.failing || e.state === "missing";
export const isMonitoredOnly = (e: EntryView) =>
  !e.failing && (e.state === "passed" || e.state === "never");

function failuresPlan(n: number, width: number, runningCount: number): LayoutPlan["failures"] {
  if (n === 0) return null;
  const busy = runningCount > 4;
  if (n <= 3) return { mode: "card", columns: n, rows: 1, height: busy ? 230 : 320 };
  if (n <= 6 && !busy) {
    const columns = Math.min(3, Math.ceil(n / 2));
    const rows = Math.ceil(n / columns);
    return { mode: "small", columns, rows, height: rows * 190 + (rows - 1) * 14 };
  }
  const cap = busy ? 300 : 400;
  const maxRows = Math.max(1, Math.floor((cap + 14) / (56 + 14)));
  const columns = Math.max(width >= 1500 ? 3 : 2, Math.ceil(n / maxRows));
  const rows = Math.ceil(n / columns);
  return { mode: "row", columns, rows, height: Math.min(cap, rows * 74) };
}

function monitoredPlan(m: number, width: number, height: number): LayoutPlan["monitored"] {
  const avail = height - LABEL;
  let pick = UNITS[UNITS.length - 1] as (typeof UNITS)[number];
  let columns = 1;
  let rows = 1;
  for (const u of UNITS) {
    pick = u;
    columns = Math.max(1, Math.floor((width + 14) / (u.w + 14)));
    rows = Math.max(1, Math.floor((avail + 10) / (u.h + 10)));
    if (columns * rows >= m) break;
  }
  return {
    height,
    unit: pick.unit,
    columns,
    rows,
    pages: Math.max(1, Math.ceil(m / (columns * rows))),
  };
}

export function computeLayout(
  state: DashboardState,
  canvas: { width: number; height: number },
  runningCount: number,
): LayoutPlan {
  const entries = state.entries;
  const W = canvas.width - 2 * SIDE;
  const H = canvas.height - HEADER - BOTTOM;
  const failures = failuresPlan(entries.filter(isFailingEntry).length, W, runningCount);
  const rest = H - (failures ? failures.height + LABEL + GAP : 0);

  let running: LayoutPlan["running"] = null;
  if (runningCount > 0) {
    const share = runningCount <= 2 ? 0.62 : 0.84;
    const height = Math.round((rest - 2 * LABEL - GAP) * share);
    const mode = runningCount === 1 ? "single" : "split";
    const cardWidth = mode === "single" ? W : W - LIST_WIDTH - GAP;
    running = {
      height,
      mode,
      listWidth: LIST_WIDTH,
      rowHeight: Math.max(
        44,
        Math.min(120, Math.floor((height - (runningCount - 1) * 10) / runningCount)),
      ),
      graphColumns: Math.max(3, Math.floor((cardWidth - 44 + 26) / 226)),
    };
  }

  const monitoredHeight = rest - (running ? running.height + LABEL + GAP : 0);
  return {
    empty: entries.length === 0,
    failures,
    running,
    monitored: monitoredPlan(entries.filter(isMonitoredOnly).length, W, monitoredHeight),
  };
}
