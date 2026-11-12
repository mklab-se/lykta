import type { RunnerInfo } from "../../core/types.ts";

const BADGE = { gh: "GH", k8s: "K8S", lab: "LAB", self: "SELF" } as const;

/** Where a job runs: GitHub-hosted label, or the runner's detail (node, bench + device). */
export function RunnerBadge(props: { runner?: RunnerInfo; short?: boolean }) {
  const r = props.runner;
  if (!r) return null;
  const text =
    r.kind === "gh"
      ? r.label
      : props.short
        ? (r.detail ?? r.label)
        : [r.label, r.detail].filter(Boolean).join(" · ");
  return (
    <div className="runner">
      <span className={`k ${r.kind}`}>{BADGE[r.kind]}</span>
      <span className="ellipsis">{text}</span>
    </div>
  );
}
