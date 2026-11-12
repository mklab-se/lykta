/**
 * How far a run got, readable from across the room: one block per job (a matrix folds into
 * one), stage by stage. Passed blocks are green, the failed one red and larger, jobs that
 * never ran dim.
 */
import { buildGraph, type GraphNode } from "../../core/graph.ts";
import type { JobRecord } from "../../core/types.ts";

/** Stages of blocks; without a dependency graph, each job is its own stage, in order. */
export function stripStages(jobs: JobRecord[]): GraphNode[][] {
  if (jobs.length > 1 && jobs.every((j) => j.needs.length === 0))
    return buildGraph(jobs, 999)
      .columns.flat()
      .map((n) => [n]);
  return buildGraph(jobs, 999).columns;
}

export function ProgressStrip(props: { jobs: JobRecord[]; labels?: boolean }) {
  const stages = stripStages(props.jobs);
  if (!stages.length) return null;
  return (
    <div className={`strip${props.labels ? " labelled" : ""}`}>
      {stages.map((stage) => (
        <div className="stage" key={stage.map((n) => n.id).join("|")}>
          {stage.map((n) => (
            <div key={n.id} className={`seg ${n.status}`}>
              {props.labels ? <span className="ellipsis">{n.label}</span> : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
