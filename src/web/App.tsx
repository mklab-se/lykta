import { useEffect, useState } from "react";
import { useVirtualCanvas } from "./canvas.ts";
import { FailureBand } from "./components/FailureBand.tsx";
import { Header } from "./components/Header.tsx";
import { RunningArea } from "./components/RunningArea.tsx";
import { computeLayout, isFailingEntry } from "./layout.ts";
import { isStale, useDashboard } from "./stream.ts";

/** A clock that ticks once per second (live values never update faster). */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function App() {
  const stream = useDashboard();
  const canvas = useVirtualCanvas();
  const now = useNow();
  const data = stream.data;
  const stale = isStale(stream, now) ? Math.floor((now - stream.lastMessageAt) / 60_000) : null;
  const entries = data?.entries ?? [];
  const running = entries.filter((e) => e.state === "running");
  const plan = data ? computeLayout(data, canvas, running.length) : null;
  const open = (_key: string) => {};

  return (
    <div className="canvas" style={{ height: canvas.height, transform: `scale(${canvas.scale})` }}>
      <div className="drift">
        <div className="screen">
          <Header entries={entries} title={data?.title} now={now} staleMinutes={stale} />
          <div className="body">
            {plan?.failures ? (
              <FailureBand
                entries={entries.filter(isFailingEntry)}
                plan={plan.failures}
                now={now}
                onOpen={open}
              />
            ) : null}
            {plan?.running ? (
              <RunningArea entries={running} plan={plan.running} now={now} onOpen={open} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
