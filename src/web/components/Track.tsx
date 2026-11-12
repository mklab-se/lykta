/**
 * The track (spec section 3.2): every monitored workflow in its fixed slot. A workflow in the pit
 * leaves a gap, so people notice their corner is empty and look to the pit.
 */
import { motion } from "motion/react";
import { formatAgo, formatDuration } from "../../core/timing.ts";
import type { EntryView, RunRecord } from "../../core/types.ts";
import type { TileUnit, TrackLayout } from "../track.ts";
import { History } from "./History.tsx";
import { timingLabels } from "./RunCard.tsx";

const LABEL: Record<EntryView["state"], string> = {
  passed: "PASSED",
  failed: "FAILED",
  running: "RUNNING",
  never: "NEVER RUN",
  missing: "NOT FOUND",
};

function Progress(props: { e: EntryView; now: number; unit: TileUnit }) {
  const t = timingLabels(props.e, props.now);
  const active = props.e.current?.jobs.find((j) => j.status === "running");
  const step = active?.steps.find((s) => s.status === "running");
  return (
    <div className="prog">
      <span className="tbar">
        <i style={{ transform: `scaleX(${t.progress.fraction ?? 0})` }} />
      </span>
      {props.unit !== "small" ? (
        <div className="ptext">
          <span className="ellipsis">
            {active ? `${active.name} › ${step?.name ?? "starting"}` : ""}
          </span>
          <span className="el">{t.text}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Dark text on light colors, light text on dark ones (CSS color names: light text). */
export function tagText(color: string): string {
  const hex = color.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (!hex) return "#fff";
  const full = hex.length <= 4 ? [...hex.slice(0, 3)].map((c) => c + c).join("") : hex.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255);
  const luminance = 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  return luminance > 0.55 ? "#111" : "#fff";
}

/**
 * A workflow's labels as luggage tags in its color: #label on a rounded patch. A color without
 * labels is an empty tag; neither means nothing at all (the tile looks as usual).
 */
export function Tags(props: { e: EntryView }) {
  const { labels, color } = props.e;
  if (!labels?.length && !color) return null;
  const style = color ? { background: color, color: tagText(color) } : undefined;
  return (
    <div className="tags">
      {labels?.length ? (
        labels.map((l) => (
          <span key={l} className="tag" style={style}>
            {`#${l}`}
          </span>
        ))
      ) : (
        <span className="tag empty" style={style} />
      )}
    </div>
  );
}

function Tile(props: { e: EntryView; unit: TileUnit; now: number; onOpen: (key: string) => void }) {
  const { e, unit, now } = props;
  const running = e.state === "running" && e.current;
  const run = e.latestCompleted as RunRecord | undefined;
  const when = run?.completedAt ? formatAgo(now - Date.parse(run.completedAt)) : "";
  return (
    <motion.div
      layoutId={e.key}
      layoutDependency={`${e.state}:${unit}`}
      className={`tile ${unit} ${e.state}`}
      data-entry={e.key}
      onClick={() => props.onOpen(e.key)}
    >
      <div className="top">
        <span className={`dot ${e.state}`} />
        {unit === "xl" || unit === "big" || unit === "mid" ? (
          <span className="lbl">{LABEL[e.state]}</span>
        ) : (
          <span className="nm ellipsis">{e.name}</span>
        )}
        {running && e.failing ? <span className="rerun" /> : null}
        {unit === "xl" || unit === "big" || unit === "mid" ? (
          <span className="when">{running ? "" : when}</span>
        ) : null}
      </div>
      {unit === "xl" || unit === "big" || unit === "mid" ? (
        <div className="nm ellipsis">{e.name}</div>
      ) : null}
      {unit === "xl" || unit === "big" ? (
        <div className="sub ellipsis">
          {running
            ? `${e.repo} · ${e.branch}`
            : run
              ? `${run.sha.slice(0, 7)} · ${run.actor}${e.lastDurationMs !== undefined ? ` · took ${formatDuration(e.lastDurationMs)}` : ""}`
              : "Monitored, waiting for its first run"}
        </div>
      ) : null}
      {unit === "tiny" ? null : (
        <div className="foot">
          {running ? <Progress e={e} now={now} unit={unit} /> : <History history={e.history} />}
          <Tags e={e} />
        </div>
      )}
    </motion.div>
  );
}

export function Track(props: {
  entries: EntryView[];
  /** Keys of the workflows in the pit: their slots stay empty. */
  pit: ReadonlySet<string>;
  layout: TrackLayout;
  now: number;
  onOpen: (key: string) => void;
  /** The spotlight is open: the track goes out of focus. */
  dimmed?: boolean;
  /** The server has not finished its first sync with GitHub yet. */
  connecting?: boolean;
}) {
  const { layout, entries } = props;
  if (entries.length === 0) {
    return (
      <div className="empty">
        {props.connecting ? (
          <div>
            Connecting to GitHub...
            <small>Reading the monitored workflows. This takes a few seconds.</small>
          </div>
        ) : (
          <div>
            Nothing is monitored yet
            <small>Add workflows to lykta.yaml to see them here.</small>
          </div>
        )}
      </div>
    );
  }
  return (
    <>
      <div className={`section-label grid-label${props.dimmed ? " dimmed" : ""}`}>
        {`THE GRID · ${entries.length - props.pit.size}`}
      </div>
      <div
        className={`track${props.dimmed ? " dimmed" : ""}`}
        style={{
          width: layout.gridWidth,
          height: layout.height - layout.gridTop,
          gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${layout.rows}, ${layout.tileHeight}px)`,
        }}
      >
        {entries.map((e) =>
          props.pit.has(e.key) ? (
            <div key={e.key} className="slot gap" />
          ) : (
            <div key={e.key} className="slot">
              <Tile e={e} unit={layout.unit} now={props.now} onOpen={props.onOpen} />
            </div>
          ),
        )}
      </div>
    </>
  );
}
