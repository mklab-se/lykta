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

export interface RunningPlan {
  height: number;
  /** single: one full card; split: list + rotating detail; list: rows only (no room for detail). */
  mode: "single" | "split" | "list";
  listWidth: number;
  listColumns: number;
  rowHeight: number;
  rowGap: number;
  /** Running workflows that do not fit even in the densest list (extreme screens only). */
  hidden: number;
  graphColumns: number;
}

export interface LayoutPlan {
  empty: boolean;
  failures: {
    height: number;
    mode: "card" | "small" | "row";
    columns: number;
    rows: number;
  } | null;
  running: RunningPlan | null;
  monitored: { height: number; unit: MonitoredUnit; columns: number; rows: number; pages: number };
}

const CARD_MIN = 260;
const ROW = { normal: 44, compact: 30, max: 120 };
const GAPS = { normal: 10, compact: 4 };
const MONITORED_MIN = LABEL + 36;

export const isFailingEntry = (e: EntryView) => e.failing || e.state === "missing";
export const isMonitoredOnly = (e: EntryView) =>
  !e.failing && (e.state === "passed" || e.state === "never");

function failuresPlan(n: number, width: number, H: number, busy: boolean): LayoutPlan["failures"] {
  if (n === 0) return null;
  const cardH = Math.min(busy ? 230 : 320, Math.round(0.4 * H));
  if (n <= 3 && cardH >= 190) return { mode: "card", columns: n, rows: 1, height: cardH };
  if (n >= 4 && n <= 6 && !busy) {
    const columns = Math.min(3, Math.ceil(n / 2));
    const rows = Math.ceil(n / columns);
    const height = rows * 190 + (rows - 1) * 14;
    if (height <= 0.45 * H) return { mode: "small", columns, rows, height };
  }
  // dense rows: as few columns as possible (readable from across a room), never dropping one
  const cap = Math.round((busy ? 0.45 : 0.6) * H);
  const need = (rows: number) => rows * 56 + (rows - 1) * 14;
  let columns = width >= 1500 ? 3 : 2;
  while (columns < n && need(Math.ceil(n / columns)) > cap) columns++;
  const rows = Math.ceil(n / columns);
  return { mode: "row", columns, rows, height: Math.max(need(rows), Math.min(cap, rows * 74)) };
}

function runningPlan(r: number, W: number, rest: number, monitoredMin: number): RunningPlan | null {
  if (r === 0) return null;
  const share = r <= 2 ? 0.62 : 0.84;
  const desired = Math.round((rest - 2 * LABEL - GAP) * share);
  // the band below always keeps its gap; the monitored band gives up its space first
  const roomWithMonitored = rest - LABEL - GAP - monitoredMin;
  const roomAll = Math.max(0, rest - LABEL - GAP);
  const graphColumns = (cardWidth: number) => Math.max(3, Math.floor((cardWidth - 44 + 26) / 226));
  const fit = (want: number) =>
    Math.min(Math.max(desired, want), roomWithMonitored >= want ? roomWithMonitored : roomAll);

  if (r === 1) {
    const height = fit(CARD_MIN);
    if (height >= CARD_MIN) {
      return {
        height,
        mode: "single",
        listWidth: LIST_WIDTH,
        listColumns: 1,
        rowHeight: ROW.max,
        rowGap: 0,
        hidden: 0,
        graphColumns: graphColumns(W),
      };
    }
  }
  // the densest list that fits: normal rows, compact rows, then more list columns
  const options: [cols: number, row: number, gap: number][] = [
    [1, ROW.normal, GAPS.normal],
    [1, ROW.compact, GAPS.compact],
    [2, ROW.compact, GAPS.compact],
    [3, ROW.compact, GAPS.compact],
  ];
  const need = (cols: number, row: number, gap: number) => {
    const perCol = Math.ceil(r / cols);
    return perCol * row + (perCol - 1) * gap;
  };
  const chosen =
    options.find(([c, row, gap]) => need(c, row, gap) <= Math.max(roomWithMonitored, 0)) ??
    options.find(([c, row, gap]) => need(c, row, gap) <= roomAll) ??
    options[options.length - 1];
  const [listColumns, minRow, rowGap] = chosen as [number, number, number];
  const height = fit(Math.max(need(listColumns, minRow, rowGap), r >= 2 ? CARD_MIN : 0));
  const perCol = Math.ceil(r / listColumns);
  const fitsPerCol = Math.max(1, Math.floor((height + rowGap) / (minRow + rowGap)));
  const shownPerCol = Math.min(perCol, fitsPerCol);
  const capacity = shownPerCol * listColumns;
  // when some do not fit, one slot shows "+N more running"
  const hidden = r > capacity ? r - (capacity - 1) : 0;
  const rowHeight = Math.max(
    minRow,
    Math.min(ROW.max, Math.floor((height - (shownPerCol - 1) * rowGap) / shownPerCol)),
  );
  const listWidth = listColumns === 1 ? LIST_WIDTH : listColumns === 2 ? 900 : 1200;
  const mode = height >= CARD_MIN ? "split" : "list";
  return {
    height,
    mode,
    listWidth: mode === "list" ? W : listWidth,
    listColumns,
    rowHeight,
    rowGap,
    hidden,
    graphColumns: graphColumns(W - listWidth - GAP),
  };
}

function monitoredPlan(m: number, width: number, height: number): LayoutPlan["monitored"] {
  const avail = Math.max(0, height - LABEL);
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
  const H = Math.max(0, canvas.height - HEADER - BOTTOM);
  const monitoredCount = entries.filter(isMonitoredOnly).length;
  const failures = failuresPlan(entries.filter(isFailingEntry).length, W, H, runningCount > 4);
  const rest = Math.max(0, H - (failures ? failures.height + LABEL + GAP : 0));
  const running = runningPlan(runningCount, W, rest, monitoredCount ? MONITORED_MIN : 0);
  const monitoredHeight = Math.max(0, rest - (running ? running.height + LABEL + GAP : 0));
  return {
    empty: entries.length === 0,
    failures,
    running,
    monitored: monitoredPlan(monitoredCount, W, monitoredHeight),
  };
}
