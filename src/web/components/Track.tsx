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
      {unit === "tiny" ? null : running ? (
        <Progress e={e} now={now} unit={unit} />
      ) : (
        <History history={e.history} />
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
    <div
      className={`track${props.dimmed ? " dimmed" : ""}`}
      style={{
        width: layout.gridWidth,
        height: layout.height,
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
  );
}
