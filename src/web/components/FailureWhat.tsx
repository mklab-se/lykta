import type { EntryView } from "../../core/types.ts";

/**
 * "frameworks/base/core/java/android/os/Battery.java:212: error: ..." spends the line on the
 * path and cuts the error. Paths of three or more folders keep only their file. URLs stay.
 */
export function shortenPaths(line: string): string {
  return line.replace(/(?<![\w:/.-])(?:[\w.-]+\/){3,}([\w.-]+)/g, (m, file: string, at: number) =>
    line.slice(Math.max(0, at - 3), at).includes("://") ? m : `…/${file}`,
  );
}

/** GitHub's closing line for a failed step: says nothing, never shown as the error. */
export const GENERIC = /^(##\[error\]|Error: )?Process completed with exit code \d+\.?$/;

/** Where it broke and the error message itself: the biggest text on a failure. */
export function FailureWhat(props: {
  e: EntryView;
  big?: boolean;
  /** At most this many error lines (a tight card shows only the first, the cause). */
  max?: number;
}) {
  const f = props.e.failure;
  if (!f) return null;
  const fallback = f.logExcerpt.filter((l) => !GENERIC.test(l)).slice(-1);
  const all = f.errors?.length ? f.errors : f.reason ? [f.reason] : fallback;
  const lines = all.slice(0, props.max ?? all.length);
  return (
    <div className={`what${props.big ? " big" : ""}`}>
      <div className="where">
        <span className="x">✕</span>
        <span className="ellipsis">{f.step ? `${f.job} › ${f.step}` : f.job}</span>
      </div>
      {lines.map((l, i) => (
        <div key={l} className={i === 0 ? "errline first" : "errline"}>
          {shortenPaths(l)}
        </div>
      ))}
    </div>
  );
}
