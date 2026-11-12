import { formatClock } from "../../core/timing.ts";
import type { EntryView } from "../../core/types.ts";

export function Header(props: {
  entries: EntryView[];
  title?: string;
  now: number;
  staleMinutes: number | null;
}) {
  const { entries } = props;
  const failing = entries.filter((e) => e.failing || e.state === "missing").length;
  const running = entries.filter((e) => e.state === "running").length;
  const passing = entries.filter((e) => e.state === "passed").length;
  return (
    <div className="header">
      <div className="brand">
        <div className="lantern" />
        LYKTA
      </div>
      {props.title ? <div className="title">{props.title}</div> : null}
      <div className="counts">
        <div className="count red">
          <b>{failing}</b> failing
        </div>
        <div className="count amber">
          <b>{running}</b> running
        </div>
        <div className="count green">
          <b>{passing}</b> passing
        </div>
        <div className="count">
          <b>{entries.length}</b> monitored
        </div>
      </div>
      {props.staleMinutes !== null ? (
        <div className="stale">Data is {props.staleMinutes} min old</div>
      ) : null}
      <div className="clock">{formatClock(props.now)}</div>
    </div>
  );
}
