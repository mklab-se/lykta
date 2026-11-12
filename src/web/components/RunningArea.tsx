import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { formatClock, formatDuration, runProgress } from "../../core/timing.ts";
import type { EntryView, RunRecord } from "../../core/types.ts";
import { newFailingRun } from "../arrivals.ts";
import type { LayoutPlan } from "../layout.ts";
import { dwellSeconds, nextSelection, type Selection } from "../rotation.ts";
import { JobGraph } from "./JobGraph.tsx";
import { JobLanes } from "./JobLanes.tsx";

type Plan = NonNullable<LayoutPlan["running"]>;

const repoName = (e: EntryView) => e.repo.split("/")[1] ?? e.repo;

export function timingLabels(e: EntryView, now: number) {
  const run = e.current as RunRecord;
  const p = runProgress(run, e.expectedMs, now);
  return {
    progress: p,
    text: e.expectedMs
      ? `${formatDuration(p.elapsedMs)} of ~${formatDuration(e.expectedMs)}`
      : formatDuration(p.elapsedMs),
    eta: p.etaMs ? `done ~${formatClock(p.etaMs)}` : "",
  };
}

function RunCard(props: {
  e: EntryView;
  height: number;
  columns: number;
  now: number;
  onOpen: (key: string) => void;
  layoutId?: string;
}) {
  const { e, now } = props;
  const run = e.current as RunRecord;
  const t = timingLabels(e, now);
  const done = run.jobs.filter((j) => j.status === "success").length;
  const graphH = Math.min(300, Math.max(200, props.height * 0.45));
  const lanes =
    props.height >= 420 ? Math.max(0, Math.floor((props.height - 160 - graphH) / 40)) : 0;
  return (
    <motion.div
      className="run"
      layoutId={props.layoutId ?? e.key}
      data-entry={e.key}
      onClick={() => props.onOpen(e.key)}
    >
      <div className="tag">
        <span className="dot running" />
        RUNNING
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
      <div className="name ellipsis">
        {e.name} <span className="repo">· {repoName(e)}</span>
      </div>
      <JobGraph
        run={run}
        columns={props.columns}
        style={lanes ? { flex: "none", height: graphH } : undefined}
      />
      {lanes ? <JobLanes run={run} max={lanes} now={now} /> : null}
      <div className="meta">
        <span>
          <b>{run.branch}</b>
        </span>
        <span className="mono">{run.sha.slice(0, 7)}</span>
        <span>
          by <b>{run.actor}</b>
        </span>
      </div>
    </motion.div>
  );
}

function RunRow(props: {
  e: EntryView;
  selected: boolean;
  height: number;
  now: number;
  onOpen: (key: string) => void;
}) {
  const { e, now } = props;
  const t = timingLabels(e, now);
  const active = e.current?.jobs.filter((j) => j.status === "running") ?? [];
  const j = active[0];
  const step = j?.steps.find((s) => s.status === "running");
  const roomy = props.height >= 86;
  const compact = props.height < 44;
  return (
    <motion.div
      layoutId={e.key}
      className={`rrow${props.selected ? " sel" : ""}${t.progress.slow ? " slow" : ""}${compact ? " compact" : ""}`}
      style={{ height: props.height }}
      data-entry={e.key}
      onClick={() => props.onOpen(e.key)}
    >
      <div className="sel-bg" />
      <div className="r1">
        <span className="dot running" />
        <span className="nm ellipsis">
          {e.name} <span className="repo">· {repoName(e)}</span>
        </span>
        <span className="el">{t.text}</span>
      </div>
      <div className="r2" hidden={compact}>
        <span className="tbar">
          <i style={{ transform: `scaleX(${t.progress.fraction ?? 0})` }} />
        </span>
        {roomy && t.eta ? <span className="eta2">{t.eta}</span> : null}
      </div>
      {roomy && j ? (
        <div className="r3 ellipsis">
          {j.name}
          {active.length > 1 ? <span className="repo"> +{active.length - 1}</span> : null} ›{" "}
          {step?.name ?? "starting"}
        </div>
      ) : null}
    </motion.div>
  );
}

export function RunningArea(props: {
  entries: EntryView[];
  plan: Plan;
  now: number;
  pinnedKey?: string;
  onOpen: (key: string) => void;
}) {
  const { entries, plan, now } = props;
  const keys = entries.map((e) => e.key);
  const [sel, setSel] = useState<Selection>({ selectedKey: null, selectedAt: now });
  const seenFailing = useRef(new Set<string>());
  const runs = entries.map((e) => ({
    key: e.key,
    runId: e.current?.id ?? 0,
    failed: e.current?.jobs.some((j) => j.status === "failure") ?? false,
  }));

  // biome-ignore lint/correctness/useExhaustiveDependencies: advance once per clock tick
  useEffect(() => {
    const r = newFailingRun(seenFailing.current, runs);
    seenFailing.current = r.seen;
    const fresh = r.jumpTo;
    setSel((s) => nextSelection(s, keys, now, fresh));
  }, [now, keys.join("|")]);

  const selectedKey =
    props.pinnedKey && keys.includes(props.pinnedKey)
      ? props.pinnedKey
      : sel.selectedKey && keys.includes(sel.selectedKey)
        ? sel.selectedKey
        : keys[0];
  const selected = entries.find((e) => e.key === selectedKey) ?? entries[0];
  if (!selected) return null;

  if (plan.mode === "single") {
    return (
      <div className="band" style={{ height: plan.height + 28 }}>
        <div className="section-label">IN PROGRESS · 1</div>
        <div style={{ height: plan.height, display: "grid" }}>
          <RunCard
            e={selected}
            height={plan.height}
            columns={plan.graphColumns}
            now={now}
            onOpen={props.onOpen}
          />
        </div>
      </div>
    );
  }

  const dwell = dwellSeconds(entries.length);
  const shown = plan.hidden > 0 ? entries.slice(0, entries.length - plan.hidden) : entries;
  const perCol = Math.ceil(shown.length / plan.listColumns);
  const list = (
    <div
      className="rlist"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${plan.listColumns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${perCol}, ${plan.rowHeight}px)`,
        gridAutoFlow: "column",
        gap: `${plan.rowGap}px 14px`,
      }}
    >
      {shown.map((e) => (
        <RunRow
          key={e.key}
          e={e}
          selected={plan.mode === "split" && e.key === selected.key}
          height={plan.rowHeight}
          now={now}
          onOpen={props.onOpen}
        />
      ))}
      {plan.hidden > 0 ? <div className="rmore">{`+${plan.hidden} more running`}</div> : null}
    </div>
  );
  return (
    <div className="band">
      <div className="section-label">IN PROGRESS · {entries.length}</div>
      {plan.mode === "list" ? (
        <div style={{ height: plan.height }}>{list}</div>
      ) : (
        <div
          className="split"
          style={{ height: plan.height, gridTemplateColumns: `${plan.listWidth}px 1fr` }}
        >
          {list}
          <div className="detail">
            <RunCard
              e={selected}
              height={plan.height}
              columns={plan.graphColumns}
              now={now}
              onOpen={props.onOpen}
              layoutId="detail-panel"
            />
            {props.pinnedKey ? null : (
              <div className="dwell">
                <i
                  key={`${selected.key}:${sel.selectedAt}`}
                  style={{ animationDuration: `${dwell}s` }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
