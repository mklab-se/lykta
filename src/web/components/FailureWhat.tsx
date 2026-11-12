import type { EntryView } from "../../core/types.ts";

/** Where it broke and the error message itself: the biggest text on a failure. */
export function FailureWhat(props: { e: EntryView; big?: boolean }) {
  const f = props.e.failure;
  if (!f) return null;
  const lines = f.errors?.length ? f.errors : f.reason ? [f.reason] : f.logExcerpt.slice(-1);
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
