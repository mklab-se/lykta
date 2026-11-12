import { motion } from "motion/react";
import { formatAgo, formatDuration } from "../../core/timing.ts";
import type { EntryView } from "../../core/types.ts";
import { type LayoutPlan, UNITS } from "../layout.ts";

type Plan = LayoutPlan["monitored"];

const repoName = (e: EntryView) => e.repo.split("/")[1] ?? e.repo;
const when = (e: EntryView, now: number) =>
  e.latestCompleted?.completedAt ? formatAgo(now - Date.parse(e.latestCompleted.completedAt)) : "";

function History(props: { e: EntryView }) {
  return (
    <div className="hist">
      {props.e.history.map((h, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the strip is positional (oldest to newest)
        <i key={i} className={h} />
      ))}
    </div>
  );
}

function Tile(props: {
  e: EntryView;
  unit: Plan["unit"];
  now: number;
  onOpen: (key: string) => void;
}) {
  const { e, now, unit } = props;
  const never = e.state === "never";
  // measure only when what decides the layout changes, not on every clock tick
  const common = {
    layoutId: e.key,
    layoutDependency: `${e.state}:${unit}`,
    "data-entry": e.key,
    onClick: () => props.onOpen(e.key),
  };
  if (unit === "big") {
    const run = e.latestCompleted;
    return (
      <motion.div {...common} className={`itile big ${e.state}`}>
        <div className="top">
          <span className={`dot ${e.state}`} />
          {never ? "NEVER RUN" : "PASSED"}
          <span className="when">{when(e, now)}</span>
        </div>
        <div className="nm ellipsis">{e.name}</div>
        <div className="rp ellipsis">
          {e.repo} · {e.branch}
        </div>
        {never || !run ? (
          <div className="sub">Monitored, waiting for its first run</div>
        ) : (
          <>
            <div className="sub ellipsis">
              <span className="mono">{run.sha.slice(0, 7)}</span> · {run.actor}
              {e.lastDurationMs !== undefined ? ` · took ${formatDuration(e.lastDurationMs)}` : ""}
            </div>
            <History e={e} />
          </>
        )}
      </motion.div>
    );
  }
  if (unit === "mid") {
    return (
      <motion.div {...common} className={`itile mid ${e.state}`}>
        <div className="top">
          <span className={`dot ${e.state}`} />
          <span className="ellipsis">
            {e.name} <span className="repo">· {repoName(e)}</span>
          </span>
          <span className="when">{never ? "never run" : when(e, now)}</span>
        </div>
        {never ? <div className="sub">waiting for its first run</div> : <History e={e} />}
      </motion.div>
    );
  }
  if (unit === "chip") {
    return (
      <motion.div {...common} className={`chip ${e.state}`}>
        <span className={`dot ${e.state}`} />
        <div className="txt">
          <div className="nm ellipsis">
            {e.name} · {repoName(e)}
          </div>
          <div className="sub ellipsis">{never ? "never run" : `passed ${when(e, now)}`}</div>
        </div>
      </motion.div>
    );
  }
  return (
    <motion.div {...common} className={`cell ${unit} ${e.state}`}>
      <span className={`dot ${e.state}`} />
      <span className="ellipsis">
        {repoName(e)} · {e.name}
      </span>
    </motion.div>
  );
}

export function MonitoredBand(props: {
  entries: EntryView[];
  plan: Plan;
  page: number;
  now: number;
  onOpen: (key: string) => void;
  /** Show the "nothing monitored" message when there are no entries at all. */
  allEmpty?: boolean;
}) {
  const { plan, entries } = props;
  if ((props.allEmpty ?? entries.length === 0) && entries.length === 0) {
    return (
      <div className="empty">
        <div>
          Nothing is monitored yet
          <small>Add workflows to lykta.yaml to see them here.</small>
        </div>
      </div>
    );
  }
  const per = plan.columns * plan.rows;
  const p = plan.pages > 1 ? props.page % plan.pages : 0;
  const shown = entries.slice(p * per, p * per + per);
  const unitHeight = UNITS.find((u) => u.unit === plan.unit)?.h ?? 44;
  return (
    <div className="band" style={{ height: plan.height }}>
      <div className="section-label">
        ALL MONITORED · {entries.length}
        {plan.pages > 1 ? (
          <span className="pager">
            {Array.from({ length: plan.pages }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: page dots are positional
              <i key={i} className={i === p ? "on" : ""} />
            ))}
          </span>
        ) : null}
      </div>
      <div
        className="grid-fill"
        style={{
          gridTemplateColumns: `repeat(${plan.columns}, minmax(0, 1fr))`,
          gridAutoRows: `${unitHeight}px`,
          gap: "10px 14px",
          alignContent: "start",
        }}
      >
        {shown.map((e) => (
          <Tile key={e.key} e={e} unit={plan.unit} now={props.now} onOpen={props.onOpen} />
        ))}
      </div>
    </div>
  );
}
