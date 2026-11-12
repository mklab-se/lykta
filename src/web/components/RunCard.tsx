/**
 * The big run cards shown in the spotlight: a running workflow (where it is, how far against
 * its usual time) and a run's last turn when it finished (passed, or failed with where and why).
 */
import { formatClock, formatDuration, runProgress } from "../../core/timing.ts";
import type { EntryView, RunRecord } from "../../core/types.ts";
import { FailureWhat } from "./FailureWhat.tsx";
import { JobGraph } from "./JobGraph.tsx";
import { JobLanes } from "./JobLanes.tsx";

/** "QUEUED" / "WAITING" for runs that have not started, else "RUNNING". */
export function runLabel(run: RunRecord): "QUEUED" | "WAITING" | "RUNNING" {
  if (run.status === "queued") return "QUEUED";
  if (run.status === "waiting") return "WAITING";
  return "RUNNING";
}

export function timingLabels(e: EntryView, now: number) {
  const run = e.current as RunRecord;
  const p = runProgress(run, e.expectedMs, now);
  const overdue = e.expectedMs !== undefined && p.elapsedMs > e.expectedMs;
  const label = runLabel(run);
  return {
    progress: p,
    text:
      label !== "RUNNING"
        ? label.toLowerCase()
        : e.expectedMs
          ? `${formatDuration(p.elapsedMs)} of ~${formatDuration(e.expectedMs)}`
          : formatDuration(p.elapsedMs),
    eta: p.etaMs ? `done ~${formatClock(p.etaMs)}` : overdue ? "overdue" : "",
  };
}

function Meta(props: { run: RunRecord }) {
  const { run } = props;
  return (
    <div className="meta">
      <span>
        <b>{run.branch}</b>
      </span>
      <span className="mono">{run.sha.slice(0, 7)}</span>
      <span>
        by <b>{run.actor}</b>
      </span>
    </div>
  );
}

const graphColumns = (width: number) => Math.max(3, Math.floor((width - 44 + 26) / 226));

/** The spotlight fills a screen: the graph is laid out smaller and scaled up to fill it. */
const ZOOM = 1.5;

function Zoomed(props: { height: number; children: React.ReactNode }) {
  return (
    <div className="zoom" style={{ height: props.height }}>
      <div
        style={{
          width: `${100 / ZOOM}%`,
          height: props.height / ZOOM,
          transform: `scale(${ZOOM})`,
          transformOrigin: "0 0",
          display: "flex",
        }}
      >
        {props.children}
      </div>
    </div>
  );
}

export function RunningCard(props: { e: EntryView; width: number; height: number; now: number }) {
  const { e, now } = props;
  const run = e.current as RunRecord;
  const t = timingLabels(e, now);
  const done = run.jobs.filter((j) => j.status === "success").length;
  const graphH = Math.max(260, Math.round(props.height * 0.55));
  const lanes =
    props.height >= 480 ? Math.max(0, Math.floor((props.height - 220 - graphH) / 40)) : 0;
  return (
    <div className="run spot">
      <div className="tag">
        <span className={`dot ${runLabel(run) === "RUNNING" ? "running" : "never"}`} />
        {runLabel(run)}
        <span className="progress">
          {done}/{run.jobs.length} jobs
        </span>
        {t.progress.slow ? <span className="slowtag">SLOWER THAN USUAL</span> : null}
        <span className="elapsed">{t.text}</span>
      </div>
      {t.progress.fraction !== null ? (
        <div className="eta">
          <span className="tbar">
            <i style={{ transform: `scaleX(${t.progress.fraction})` }} />
          </span>
          <span>{t.eta}</span>
        </div>
      ) : null}
      <div className="name ellipsis">{e.name}</div>
      <Zoomed height={graphH}>
        <JobGraph run={run} columns={graphColumns(props.width / ZOOM)} />
      </Zoomed>
      {lanes ? <JobLanes run={run} max={lanes} now={now} /> : null}
      <Meta run={run} />
    </div>
  );
}

export function FinishedCard(props: { e: EntryView; width: number; height: number }) {
  const { e } = props;
  const run = e.latestCompleted as RunRecord;
  const failed = run.conclusion !== "success";
  const done = run.jobs.filter((j) => j.status === "success").length;
  return (
    <div className={`run spot held ${failed ? "failed" : "passed"}`}>
      <div className="tag">
        <span className={`dot ${failed ? "failed" : "passed"}`} />
        {failed ? "FAILED" : "PASSED"}
        <span className="progress">
          {done}/{run.jobs.length} jobs
        </span>
        <span className="elapsed">{failed ? "heading to the pit" : "back on the track"}</span>
      </div>
      <div className="name ellipsis">{e.name}</div>
      <Zoomed height={Math.max(240, props.height - (failed ? 330 : 190))}>
        <JobGraph run={run} columns={graphColumns(props.width / ZOOM)} />
      </Zoomed>
      {failed ? <FailureWhat e={e} big /> : null}
      <Meta run={run} />
    </div>
  );
}
