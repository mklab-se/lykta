import { LayoutGroup } from "motion/react";
import { useEffect, useState } from "react";
import { useVirtualCanvas } from "./canvas.ts";
import { DemoControls } from "./components/DemoControls.tsx";
import { FailureBand } from "./components/FailureBand.tsx";
import { Header } from "./components/Header.tsx";
import { MonitoredBand } from "./components/MonitoredBand.tsx";
import { RunningArea } from "./components/RunningArea.tsx";
import { computeLayout, isFailingEntry, isMonitoredOnly } from "./layout.ts";
import { usePowerMode } from "./power.ts";
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

const PAGE_MS = 12_000;

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
  const page = Math.floor(now / PAGE_MS);
  const lowPower = usePowerMode(data?.display?.lowPower ?? "auto");

  return (
    <div
      className="canvas"
      data-power={lowPower ? "low" : "full"}
      style={{ height: canvas.height, transform: `scale(${canvas.scale})` }}
    >
      <div className="drift">
        <div className="screen">
          <Header entries={entries} title={data?.title} now={now} staleMinutes={stale} />
          <LayoutGroup>
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
              {plan ? (
                <MonitoredBand
                  entries={entries.filter(isMonitoredOnly)}
                  plan={plan.monitored}
                  page={page}
                  now={now}
                  onOpen={open}
                  allEmpty={plan.empty}
                />
              ) : null}
            </div>
          </LayoutGroup>
        </div>
      </div>
      {data?.display?.demo ? <DemoControls /> : null}
    </div>
  );
}
