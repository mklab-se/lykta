import { motion } from "motion/react";
import { renderSVG } from "uqr";
import { formatDuration } from "../../core/timing.ts";
import type { EntryView, JobRecord } from "../../core/types.ts";
import type { RunDetails } from "../../server/source.ts";
import { uniqueKeys } from "../keys.ts";

const ERROR_LINE = /error|FAILED|failed|Error|timeout|not found/;
const ICON: Record<string, string> = {
  success: "✓",
  failure: "✕",
  skipped: "–",
  running: "…",
  queued: "·",
};

const jobDuration = (j: JobRecord) =>
  j.startedAt && j.completedAt
    ? formatDuration(Date.parse(j.completedAt) - Date.parse(j.startedAt))
    : "";

function Log(props: { lines: string[]; highlightErrors: boolean }) {
  const keys = uniqueKeys(props.lines);
  return (
    <div className="biglog">
      {props.lines.map((line, i) => (
        <div
          key={keys[i]}
          className={props.highlightErrors && ERROR_LINE.test(line) ? "err" : undefined}
        >
          {line}
        </div>
      ))}
    </div>
  );
}

function Jobs(props: { jobs: JobRecord[] }) {
  return (
    <div className="jobs">
      {props.jobs.map((j) => (
        <div key={j.id} className="j">
          <span className={`st node ${j.status}`} style={{ position: "static" }}>
            {ICON[j.status] ?? ""}
          </span>
          <span>{j.name}</span>
          <span className="repo">{jobDuration(j)}</span>
        </div>
      ))}
    </div>
  );
}

/** Details for a person standing at the screen, with a QR code to open the run on a phone. */
export type OverlayView = "failure" | "running" | "passed";

/** Which view a click opens: from the failure band, the running area, or the monitored band. */
export function viewFor(e: EntryView, from: "failures" | "running" | "monitored"): OverlayView {
  if (from === "failures") return "failure";
  if (from === "running") return "running";
  return e.failing || e.state === "missing" ? "failure" : "passed";
}

export function DetailOverlay(props: {
  entry: EntryView;
  view: OverlayView;
  details: RunDetails | null;
  now: number;
  countdown: number | null;
  onClose: () => void;
}) {
  const { entry: e, details, now } = props;
  const run =
    props.view === "running" ? (e.current ?? e.latestCompleted) : (e.latestCompleted ?? e.current);
  const url = details?.runUrl ?? run?.url ?? `https://github.com/${e.repo}/actions`;
  const kind = props.view === "failure" ? "failed" : props.view;
  const jobs = details?.jobs ?? run?.jobs ?? [];
  const skipped = jobs.filter((j) => j.status === "skipped");

  return (
    <motion.div
      className="overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={props.onClose}
    >
      <motion.div
        className={`sheet ${kind}`}
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={(ev) => ev.stopPropagation()}
      >
        <div style={{ minWidth: 0 }}>
          <h2 className="ellipsis">
            {e.name} <span className="repo">· {e.repo}</span>
          </h2>
          <div className="facts">
            <span>
              branch <b>{e.branch}</b>
            </span>
            {run ? (
              <span>
                commit <b className="mono">{run.sha.slice(0, 7)}</b> by <b>{run.actor}</b>
              </span>
            ) : null}
            {kind === "failed" && e.brokenSince ? (
              <span>
                broken for <b>{formatDuration(now - Date.parse(e.brokenSince))}</b>
              </span>
            ) : null}
            {kind === "passed" && e.lastDurationMs !== undefined ? (
              <span>
                last run passed, took <b>{formatDuration(e.lastDurationMs)}</b>
              </span>
            ) : null}
            {kind === "running" && e.current?.startedAt ? (
              <span>
                running for <b>{formatDuration(now - Date.parse(e.current.startedAt))}</b>
              </span>
            ) : null}
          </div>
          {e.state === "missing" ? <div className="facts">{e.problem}</div> : null}
          {kind === "failed" && e.failure ? (
            <>
              <div className="facts">
                <span>
                  failed at <b>{e.failure.job}</b> › <b>{e.failure.step}</b>
                </span>
                {skipped.length ? (
                  <span>
                    not run because of it: <b>{skipped.map((j) => j.name).join(", ")}</b>
                  </span>
                ) : null}
              </div>
              <Log lines={details?.logExcerpt ?? e.failure.logExcerpt} highlightErrors />
            </>
          ) : null}
          {kind === "running" ? <Jobs jobs={jobs} /> : null}
          {kind === "passed" ? (
            <>
              <Jobs jobs={jobs} />
              {details?.logExcerpt.length ? (
                <>
                  <div className="facts">Last lines of the log</div>
                  <Log lines={details.logExcerpt} highlightErrors={false} />
                </>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="qr">
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generated locally by uqr from the run URL */}
          <div dangerouslySetInnerHTML={{ __html: renderSVG(url) }} />
          Open on your phone
        </div>
      </motion.div>
      {props.countdown !== null ? (
        <div className="countdown">Closing in {props.countdown} s</div>
      ) : null}
    </motion.div>
  );
}
