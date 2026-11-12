import type { EntryView } from "../../core/types.ts";

/** Where it broke and the error message itself: the biggest text on a failure. */
export function FailureWhat(props: {
  e: EntryView;
  big?: boolean;
  /** At most this many error lines (a tight card shows only the first, the cause). */
  max?: number;
}) {
  const f = props.e.failure;
  if (!f) return null;
  const all = f.errors?.length ? f.errors : f.reason ? [f.reason] : f.logExcerpt.slice(-1);
  const lines = all.slice(0, props.max ?? all.length);
  return (
    <div className={`what${props.big ? " big" : ""}`}>
      <div className="where">
        <span className="x">✕</span>
        <span className="ellipsis">{f.step ? `${f.job} › ${f.step}` : f.job}</span>
      </div>
      {lines.map((l) => (
        <div key={l} className="errline">
          {l}
        </div>
      ))}
    </div>
  );
}
