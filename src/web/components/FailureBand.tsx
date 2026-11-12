import { AnimatePresence, motion } from "motion/react";
import { formatDuration } from "../../core/timing.ts";
import type { EntryView } from "../../core/types.ts";
import { uniqueKeys } from "../keys.ts";
import type { LayoutPlan } from "../layout.ts";
import { FailureWhat } from "./FailureWhat.tsx";
import { ProgressStrip } from "./ProgressStrip.tsx";
import { RunnerBadge } from "./RunnerBadge.tsx";

type Plan = NonNullable<LayoutPlan["failures"]>;

const ERROR_LINE = /error|FAILED|failed|Error|timeout|not found/;
const repoName = (e: EntryView) => e.repo.split("/")[1] ?? e.repo;

/**
 * A failure that is not re-running shares its identity with the run card it came from, so
 * when a held run's time is up it morphs into this card. While it re-runs it is in both
 * places at once and keeps its own.
 */
const failLayoutId = (e: EntryView) => (e.state === "running" ? `fail:${e.key}` : e.key);

function broken(e: EntryView, now: number): string {
  return e.brokenSince ? formatDuration(now - Date.parse(e.brokenSince)) : "";
}

/** One strong pulse when a failure arrives on this screen, then calm. */
function Arrival(props: { fresh: boolean }) {
  if (!props.fresh) return null;
  return (
    <motion.div
      className="ring"
      initial={{ opacity: 0.9, scale: 1 }}
      animate={{ opacity: 0, scale: 1.04 }}
      transition={{ duration: 1.4, ease: [0.2, 0.9, 0.2, 1] }}
    />
  );
}

function FailCard(props: {
  e: EntryView;
  fresh: boolean;
  now: number;
  small: boolean;
  /** A short card (busy wall): the error must still fit, so less important lines go. */
  tight?: boolean;
  onOpen: (key: string) => void;
}) {
  const { e, now } = props;
  const commonProps = {
    layoutId: failLayoutId(e),
    layoutDependency: `${e.state}:${props.small}`,
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.9, transition: { duration: 0.6 } },
    className: "fail",
    "data-entry": e.key,
    onClick: () => props.onOpen(e.key),
  };
  if (e.state === "missing") {
    return (
      <motion.div {...commonProps}>
        <div className="glow" />
        <div className="tag">
          <span className="dot missing" />
          NOT FOUND
        </div>
        <div className="name ellipsis">{e.name}</div>
        <div className="repo ellipsis" style={{ marginTop: -6, fontSize: 20 }}>
          {e.repo} · {e.branch}
        </div>
        <div className="problem">{e.problem}</div>
      </motion.div>
    );
  }
  const f = e.failure;
  const run = e.latestCompleted;
  const tight = props.small || props.tight === true;
  return (
    <motion.div {...commonProps}>
      <div className="glow" />
      <Arrival fresh={props.fresh} />
      <div className="tag">
        <span className="dot failed" />
        FAILED
        {tight ? <span className="brokentag">Broken for {broken(e, now)}</span> : null}
      </div>
      <div className="name ellipsis">{e.name}</div>
      {tight ? null : (
        <>
          <div className="repo ellipsis" style={{ marginTop: -6, fontSize: 20 }}>
            {e.repo} · {e.branch}
          </div>
          <div className="broken">Broken for {broken(e, now)}</div>
        </>
      )}
      {run?.jobs.length ? <ProgressStrip jobs={run.jobs} labels={!props.small} /> : null}
      <FailureWhat e={e} max={tight ? 1 : undefined} />
      {tight ? null : <RunnerBadge runner={f?.runner} />}
      {/* with error lines, the log behind them is left to the detail view */}
      {!props.small && !f?.errors?.length && f?.logExcerpt.length ? (
        <div className="log">
          {(() => {
            const lines = f.logExcerpt.slice(-4);
            const keys = uniqueKeys(lines);
            return lines.map((line, i) => ({ key: keys[i] as string, line }));
          })().map(({ key, line }) => (
            <span key={key} className={ERROR_LINE.test(line) ? "err" : undefined}>
              {line}
            </span>
          ))}
        </div>
      ) : null}
      {!tight && run ? (
        <div className="meta">
          <span className="mono">{run.sha.slice(0, 7)}</span>
          <span>
            by <b>{run.actor}</b>
          </span>
        </div>
      ) : null}
    </motion.div>
  );
}

function FailRow(props: {
  e: EntryView;
  now: number;
  fresh: boolean;
  onOpen: (key: string) => void;
}) {
  const { e, now } = props;
  const sub =
    e.state === "missing"
      ? "workflow not found"
      : e.failure
        ? `${e.failure.job} › ${e.failure.step}`
        : "";
  return (
    <motion.div
      layoutId={failLayoutId(e)}
      layoutDependency={e.state}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.6 } }}
      className="failrow"
      data-entry={e.key}
      onClick={() => props.onOpen(e.key)}
    >
      <Arrival fresh={props.fresh} />
      <div className="bar" />
      <div style={{ minWidth: 0 }}>
        <div className="nm ellipsis">
          {e.name} · {repoName(e)}
        </div>
        <div className="sub ellipsis">{sub}</div>
      </div>
      {e.latestCompleted?.jobs.length && e.state !== "missing" ? (
        <ProgressStrip jobs={e.latestCompleted.jobs} />
      ) : null}
      <div className="dur">{e.state === "missing" ? "404" : broken(e, now)}</div>
    </motion.div>
  );
}

export function FailureBand(props: {
  entries: EntryView[];
  plan: Plan;
  now: number;
  onOpen: (key: string) => void;
  /** True for a failure that just arrived on this screen (see arrivals.ts). */
  isFresh?: (key: string) => boolean;
}) {
  const { plan } = props;
  return (
    <div className="band">
      <div className="section-label">NEEDS FIXING · {props.entries.length}</div>
      <div
        className="grid-fill"
        style={{
          gridTemplateColumns: `repeat(${plan.columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${plan.rows}, minmax(0, 1fr))`,
          height: plan.height,
        }}
      >
        <AnimatePresence mode="popLayout">
          {props.entries.map((e) =>
            plan.mode === "row" ? (
              <FailRow
                key={e.key}
                e={e}
                now={props.now}
                fresh={props.isFresh?.(e.key) ?? false}
                onOpen={props.onOpen}
              />
            ) : (
              <FailCard
                key={e.key}
                e={e}
                now={props.now}
                small={plan.mode === "small"}
                tight={plan.mode === "card" && plan.height < 280}
                fresh={props.isFresh?.(e.key) ?? false}
                onOpen={props.onOpen}
              />
            ),
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
