import { AnimatePresence, LayoutGroup } from "motion/react";
import { useEffect, useState } from "react";
import type { RunDetails } from "../server/source.ts";
import { useVirtualCanvas } from "./canvas.ts";
import { DemoControls } from "./components/DemoControls.tsx";
import { DetailOverlay } from "./components/DetailOverlay.tsx";
import { FailureBand } from "./components/FailureBand.tsx";
import { Header } from "./components/Header.tsx";
import { MonitoredBand } from "./components/MonitoredBand.tsx";
import { RunningArea } from "./components/RunningArea.tsx";
import { moveFocus } from "./focus.ts";
import { useAutoClose } from "./idle.ts";
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
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [details, setDetails] = useState<RunDetails | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const open = (key: string) => {
    setOpenKey(key);
    setDetails(null);
    fetch(`/api/entries/${encodeURIComponent(key)}/details`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setDetails)
      .catch(() => setDetails(null));
  };
  const close = () => {
    setOpenKey(null);
    setFocusKey(null);
  };
  const countdown = useAutoClose(openKey !== null || focusKey !== null, close);
  const openEntry = entries.find((e) => e.key === openKey);
  const order = [
    ...entries.filter(isFailingEntry),
    ...running.filter((e) => !isFailingEntry(e)),
    ...entries.filter(isMonitoredOnly),
  ].map((e) => e.key);
  const orderKey = order.join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: order changes are tracked through orderKey
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const dir = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" }[
        ev.key
      ] as "up" | "down" | "left" | "right" | undefined;
      if (dir) setFocusKey((k) => moveFocus(order, k, dir));
      else if (ev.key === "Enter" && focusKey) open(focusKey);
      else if (ev.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [orderKey, focusKey]);

  // the focused element gets an outline, found by its data-entry attribute
  useEffect(() => {
    for (const el of document.querySelectorAll(".focused")) el.classList.remove("focused");
    if (focusKey)
      document.querySelector(`[data-entry="${CSS.escape(focusKey)}"]`)?.classList.add("focused");
  });
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
                <RunningArea
                  entries={running}
                  plan={plan.running}
                  now={now}
                  onOpen={open}
                  pinnedKey={openEntry?.state === "running" ? openEntry.key : undefined}
                />
              ) : null}
              {plan && (plan.empty || plan.monitored.height >= 64) ? (
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
      <AnimatePresence>
        {openEntry ? (
          <DetailOverlay
            key={openEntry.key}
            entry={openEntry}
            details={details}
            now={now}
            countdown={countdown}
            onClose={close}
          />
        ) : null}
      </AnimatePresence>
      {data?.display?.demo ? <DemoControls /> : null}
    </div>
  );
}
