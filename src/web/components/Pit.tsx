/**
 * The pit (spec section 3.2): failed and not-found workflows, taken off the track until they are
 * fixed. Red cards with how far the run got, where it broke and the error; more compact as the
 * pit fills.
 */
import { AnimatePresence, motion } from "motion/react";
import { formatDuration } from "../../core/timing.ts";
import type { EntryView } from "../../core/types.ts";
import type { TrackLayout } from "../track.ts";
import { FailureWhat, GENERIC, shortenPaths } from "./FailureWhat.tsx";
import { ProgressStrip } from "./ProgressStrip.tsx";
import { RunnerBadge } from "./RunnerBadge.tsx";
import { Tags } from "./Track.tsx";

const CARD_CHROME = 345;
const LOG_LINE = 19;

const broken = (e: EntryView, now: number) =>
  e.brokenSince ? formatDuration(now - Date.parse(e.brokenSince)) : "";

/** One strong pulse when a workflow arrives in the pit, then calm. */
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

function Car(props: {
  e: EntryView;
  mode: "card" | "compact" | "row";
  height: number;
  now: number;
  fresh: boolean;
  onOpen: (key: string) => void;
}) {
  const { e, mode, now } = props;
  const missing = e.state === "missing";
  const f = e.failure;
  const motionProps = {
    layoutId: e.key,
    layoutDependency: `${e.state}:${mode}`,
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0, transition: { duration: 0.5 } },
    "data-entry": e.key,
    onClick: () => props.onOpen(e.key),
    style: { height: props.height },
  };
  if (mode === "row") {
    return (
      <motion.div {...motionProps} className="pitrow">
        <Arrival fresh={props.fresh} />
        <div className="bar" />
        <div style={{ minWidth: 0 }}>
          <div className="nm ellipsis">{e.name}</div>
          <div className="sub ellipsis">
            {missing ? "workflow not found" : f ? `${f.job} › ${f.step}` : ""}
          </div>
        </div>
        <div className="dur">{missing ? "404" : broken(e, now)}</div>
      </motion.div>
    );
  }
  const run = e.latestCompleted;
  // the rest of a card (title, strip, where, errors, labels) takes about this much height
  const roomForLog = Math.floor((props.height - CARD_CHROME) / LOG_LINE);
  const logLines =
    mode === "card" && f
      ? f.logExcerpt
          .filter((l) => !f.errors?.includes(l) && !GENERIC.test(l))
          .slice(-Math.max(0, roomForLog))
      : [];
  return (
    <motion.div {...motionProps} className={`fail car ${mode}`}>
      <div className="glow" />
      <Arrival fresh={props.fresh} />
      <div className="tag">
        <span className={`dot ${missing ? "missing" : "failed"}`} />
        {missing ? "NOT FOUND" : "FAILED"}
        {missing ? null : <span className="brokentag">Broken for {broken(e, now)}</span>}
      </div>
      <div className="name ellipsis">{e.name}</div>
      {missing ? (
        <div className="problem">{e.problem}</div>
      ) : (
        <>
          {mode === "card" && run ? (
            <div className="carsub">
              <span className="ellipsis">{`${run.sha.slice(0, 7)} · ${run.actor}`}</span>
              <RunnerBadge runner={f?.runner} />
            </div>
          ) : null}
          {run?.jobs.length ? <ProgressStrip jobs={run.jobs} labels={mode === "card"} /> : null}
          <FailureWhat e={e} max={mode === "card" ? 3 : 1} />
          {roomForLog >= 2 && logLines.length ? (
            // what led up to it: as many whole lines as the car has room for, newest last
            <div className="carlog">
              {logLines.map((l, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: log lines are positional
                <div key={i}>{shortenPaths(l)}</div>
              ))}
            </div>
          ) : null}
        </>
      )}
      <Tags e={e} />
    </motion.div>
  );
}

export function Pit(props: {
  entries: EntryView[];
  layout: TrackLayout;
  now: number;
  onOpen: (key: string) => void;
  /** True for a workflow that just arrived in the pit on this screen. */
  isFresh?: (key: string) => boolean;
}) {
  const { pit } = props.layout;
  const shown = props.entries.slice(0, pit.shown);
  return (
    <motion.div
      className="pit"
      style={{ width: pit.width }}
      initial={{ opacity: 0, x: -80 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -80, transition: { duration: 0.6 } }}
      transition={{ duration: 0.7, ease: [0.2, 0.9, 0.2, 1] }}
    >
      <div className="section-label">THE PIT · {props.entries.length}</div>
      <div className="cars">
        <AnimatePresence mode="popLayout">
          {shown.map((e) => (
            <Car
              key={e.key}
              e={e}
              mode={pit.mode}
              height={pit.cardHeight}
              now={props.now}
              fresh={props.isFresh?.(e.key) ?? false}
              onOpen={props.onOpen}
            />
          ))}
        </AnimatePresence>
        {pit.hidden > 0 ? (
          <div className="pitrow more" style={{ height: pit.cardHeight }}>
            {`+${pit.hidden} more in the pit`}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}
