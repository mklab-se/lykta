import { useLayoutEffect, useRef, useState } from "react";
import { buildGraph, type GraphNode } from "../../core/graph.ts";
import type { JobRecord, RunRecord } from "../../core/types.ts";
import { RunnerBadge } from "./RunnerBadge.tsx";

const ICON: Record<string, string> = { success: "✓", failure: "✕", skipped: "–" };

/** Share of a job's steps that are done (the running step counts as half). */
export function stepFraction(j: JobRecord): number {
  if (!j.steps.length) return j.status === "success" ? 1 : 0;
  const done = j.steps.filter((s) => s.status === "success").length;
  const running = j.steps.some((s) => s.status === "running") ? 0.5 : 0;
  return Math.min(1, (done + running) / j.steps.length);
}

function GroupWhere(props: { jobs: JobRecord[] }) {
  const runners = props.jobs.map((j) => j.runner).filter(Boolean);
  const first = runners[0];
  if (!first) return null;
  if (runners.every((r) => r?.kind === "k8s")) {
    const n = new Set(runners.map((r) => r?.detail ?? r?.label)).size;
    return (
      <div className="runner">
        <span className="k k8s">K8S</span>
        <span className="ellipsis">
          {n} runner{n === 1 ? "" : "s"}
        </span>
      </div>
    );
  }
  return <RunnerBadge runner={first} short />;
}

function Node(props: { run: RunRecord; n: GraphNode }) {
  const { n } = props;
  const key = `${props.run.id}:${n.id}`;
  if (n.kind === "done") {
    return (
      <div className="node collapsed done" data-node={key}>
        <div className="row">
          <span className="st" style={{ background: "var(--green)" }}>
            ✓
          </span>
          <span className="ellipsis">{n.label}</span>
        </div>
      </div>
    );
  }
  if (n.kind === "later") {
    return (
      <div className="node collapsed later" data-node={key}>
        <div className="row">
          <span className="ellipsis">{n.label}</span>
        </div>
        <div className="cnt">waiting</div>
      </div>
    );
  }
  if (n.kind === "group") {
    const count = (s: JobRecord["status"]) => n.jobs.filter((j) => j.status === s).length;
    const failed = count("failure");
    return (
      <div className={`node group ${n.status}`} data-node={key}>
        <div className="row">
          <span className="st">{ICON[n.status] ?? ""}</span>
          <span className="ellipsis">{n.label}</span>
        </div>
        <div className="dots">
          {n.jobs.map((j) => (
            <i key={j.id} className={`mini ${j.status}`} />
          ))}
        </div>
        <div className="cnt">
          {count("success")} done · {count("running")} running
          {failed ? <span style={{ color: "var(--red)" }}> · {failed} failed</span> : null}
        </div>
        <GroupWhere jobs={n.jobs} />
      </div>
    );
  }
  const j = n.jobs[0] as JobRecord;
  const step = j.steps.find((s) => s.status === "running");
  return (
    <div className={`node ${n.status}`} data-node={key}>
      <div className="row">
        <span className="st">{ICON[n.status] ?? ""}</span>
        <span className="ellipsis">{j.name}</span>
      </div>
      {n.status !== "queued" && n.status !== "skipped" ? (
        <RunnerBadge runner={j.runner} short />
      ) : null}
      {n.status === "running" ? (
        <>
          <div className="step ellipsis">{step?.name ?? "starting"}</div>
          <div className="nbar">
            <i style={{ transform: `scaleX(${stepFraction(j)})` }} />
          </div>
        </>
      ) : null}
    </div>
  );
}

interface Edge {
  d: string;
  color: string;
  flow: boolean;
}

export function JobGraph(props: { run: RunRecord; columns: number; style?: React.CSSProperties }) {
  const model = buildGraph(props.run.jobs, props.columns);
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edge[]>([]);
  const signature = JSON.stringify(model.columns.map((c) => c.map((n) => `${n.id}:${n.status}`)));

  // biome-ignore lint/correctness/useExhaustiveDependencies: redraw only when the graph shape or statuses change
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const draw = () => {
      const base = el.getBoundingClientRect();
      const k = base.width ? el.offsetWidth / base.width : 1;
      const byId = new Map(model.columns.flat().map((n) => [n.id, n]));
      const next: Edge[] = [];
      for (const [from, to] of model.edges) {
        const a = el
          .querySelector(`[data-node="${props.run.id}:${from}"]`)
          ?.getBoundingClientRect();
        const b = el.querySelector(`[data-node="${props.run.id}:${to}"]`)?.getBoundingClientRect();
        if (!a || !b) continue;
        const x1 = (a.right - base.left) * k;
        const y1 = (a.top + a.height / 2 - base.top) * k;
        const x2 = (b.left - base.left) * k;
        const y2 = (b.top + b.height / 2 - base.top) * k;
        const mx = (x1 + x2) / 2;
        const sf = byId.get(from)?.status;
        const st = byId.get(to)?.status;
        const color =
          sf === "failure"
            ? "#ff3d4d"
            : sf === "success"
              ? st === "queued"
                ? "#24402f"
                : "#2fe07f"
              : "#2a2f37";
        next.push({
          d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`,
          color,
          flow: st === "running",
        });
      }
      setEdges(next);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [signature, props.run.id]);

  return (
    <div className="graph" ref={ref} style={props.style}>
      <svg className="edges" aria-hidden="true">
        {edges.map((e) => (
          <path
            key={e.d}
            d={e.d}
            stroke={e.color}
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={e.flow ? "8 8" : undefined}
            className={e.flow ? "flow" : undefined}
          />
        ))}
      </svg>
      {model.columns.map((c) => (
        <div className="col" key={c.map((n) => n.id).join("|")}>
          {c.map((n) => (
            <Node key={n.id} run={props.run} n={n} />
          ))}
        </div>
      ))}
    </div>
  );
}
