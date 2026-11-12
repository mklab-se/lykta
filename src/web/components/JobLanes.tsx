import { isStepSlow } from "../../core/timing.ts";
import type { RunRecord } from "../../core/types.ts";
import { uniqueKeys } from "../keys.ts";
import { RunnerBadge } from "./RunnerBadge.tsx";

/** A lane per running (or just failed) job: where it runs, one segment per step, the current step. */
export function JobLanes(props: { run: RunRecord; max: number; now: number }) {
  const failed = props.run.jobs.filter((j) => j.status === "failure");
  const active = props.run.jobs.filter((j) => j.status === "running");
  const shown = [...failed, ...active].slice(0, props.max);
  const more = failed.length + active.length - shown.length;
  return (
    <div className="lanes">
      {shown.map((j) => {
        const idx = Math.max(
          0,
          j.steps.findIndex((s) => s.status === "running" || s.status === "failure"),
        );
        const step = j.steps[idx];
        const slow = step ? isStepSlow(step, step.usualMs, props.now) : false;
        const keys = uniqueKeys(j.steps.map((s) => s.name));
        return (
          <div key={j.id} className={`lane ${j.status}`}>
            <span className="ln ellipsis">{j.name}</span>
            <RunnerBadge runner={j.runner} short />
            <span className="segs">
              {j.steps.map((s, i) => (
                <i
                  key={keys[i]}
                  className={
                    s.status === "success"
                      ? "d"
                      : s.status === "failure"
                        ? "f"
                        : s.status === "running"
                          ? "n"
                          : ""
                  }
                />
              ))}
            </span>
            <span className={`cur ellipsis${slow ? " slow" : ""}`}>
              {step ? `step ${idx + 1}/${j.steps.length} · ${step.name}` : "starting"}
            </span>
          </div>
        );
      })}
      {more > 0 ? <div className="lane more">+{more} more running</div> : null}
    </div>
  );
}
