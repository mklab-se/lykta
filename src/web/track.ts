/**
 * Geometry of the track (spec section 3.2): a fixed grid of every monitored workflow, and the pit
 * on the left for failures. The grid's shape is decided for the full width, so opening the pit
 * only makes tiles narrower: no workflow ever changes row or column. Pure, so it is tested
 * without a browser.
 */

export const HEADER = 80;
export const SIDE = 40;
export const BOTTOM = 30;
export const GAP = 14;
const ASPECT = 2.2;
const PIT_LABEL = 40;

export type TileUnit = "big" | "mid" | "small" | "tiny";
export type PitMode = "card" | "compact" | "row";

const PIT_HEIGHT: Record<PitMode, number> = { card: 260, compact: 150, row: 64 };

/** Columns and rows giving the biggest tiles of about ASPECT:1 that fit all n. */
export function gridShape(n: number, width: number, height: number) {
  let best = { columns: 1, rows: 1 };
  let bestSize = -1;
  for (let columns = 1; columns <= Math.max(1, n); columns++) {
    const rows = Math.max(1, Math.ceil(n / columns));
    const w = (width - (columns - 1) * GAP) / columns;
    const h = (height - (rows - 1) * GAP) / rows;
    const size = Math.min(w, h * ASPECT);
    if (size > bestSize) {
      bestSize = size;
      best = { columns, rows };
    }
  }
  return best;
}

/** The pit is absent without failures, else about 30% of the width. */
export function pitWidth(failures: number, width: number): number {
  if (failures === 0) return 0;
  return Math.round(Math.min(640, Math.max(480, 0.3 * width)));
}

/** How dense the pit's cards are; the last slot says "+N more" when even rows do not fit. */
export function pitMode(n: number, height: number) {
  const fits = (mode: PitMode) => Math.floor((height + GAP) / (PIT_HEIGHT[mode] + GAP));
  for (const mode of ["card", "compact"] as const)
    if (fits(mode) >= n) return { mode, shown: n, hidden: 0, cardHeight: PIT_HEIGHT[mode] };
  const room = Math.max(1, fits("row"));
  const shown = n > room ? room - 1 : n;
  return { mode: "row" as const, shown, hidden: n - shown, cardHeight: PIT_HEIGHT.row };
}

function unitFor(w: number, h: number): TileUnit {
  if (h >= 170 && w >= 300) return "big";
  if (h >= 105) return "mid";
  if (h >= 60) return "small";
  return "tiny";
}

export function trackLayout(
  workflows: number,
  failures: number,
  canvas: { width: number; height: number },
) {
  const width = canvas.width - 2 * SIDE;
  const height = Math.max(0, canvas.height - HEADER - BOTTOM);
  const { columns, rows } = gridShape(workflows, width, height);
  // the pit's own label takes a line above its cars
  const pit = { width: pitWidth(failures, width), ...pitMode(failures, height - PIT_LABEL) };
  const gridWidth = width - (pit.width ? pit.width + GAP : 0);
  const tileWidth = Math.floor((gridWidth - (columns - 1) * GAP) / columns);
  const tileHeight = Math.floor((height - (rows - 1) * GAP) / rows);
  return {
    columns,
    rows,
    tileWidth,
    tileHeight,
    unit: unitFor(tileWidth, tileHeight),
    gridWidth,
    height,
    pit,
  };
}

export type TrackLayout = ReturnType<typeof trackLayout>;

/** Every entry is in the same repository, so its name need not be repeated on each one. */
export const singleRepo = (entries: { repo: string }[]) =>
  entries.length > 0 && entries.every((e) => e.repo === entries[0]?.repo);
