import { AnimatePresence, LayoutGroup } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { RunDetails } from "../server/source.ts";
import { emptyArrivals, isFresh, trackArrivals } from "./arrivals.ts";
import { useVirtualCanvas } from "./canvas.ts";
import { DemoControls } from "./components/DemoControls.tsx";
import { DetailOverlay, type OverlayView, viewFor } from "./components/DetailOverlay.tsx";
import { FailureBand } from "./components/FailureBand.tsx";
import { Header } from "./components/Header.tsx";
import { MonitoredBand } from "./components/MonitoredBand.tsx";
import { RunningArea } from "./components/RunningArea.tsx";
import { moveFocus } from "./focus.ts";
import { heldUntil, holdsFrom, partition } from "./holds.ts";
import { useAutoClose } from "./idle.ts";
import { computeLayout } from "./layout.ts";
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
  const holds = holdsFrom(data?.display);
  // running runs plus finished ones still held big (see holds.ts)
  const bands = partition(entries, now, holds);
  const running = bands.active;
  const held: Record<string, number> = {};
  for (const e of running) {
    const until = heldUntil(e, now, holds);
    if (until !== null) held[e.key] = until;
  }
  const plan = data ? computeLayout(data, canvas, running.length, bands.held) : null;
  const failingKeys = bands.failing.map((e) => e.key);
  const [arrivals, setArrivals] = useState(emptyArrivals);
  // biome-ignore lint/correctness/useExhaustiveDependencies: track when the set of failures changes
  useEffect(() => {
    if (data) setArrivals((a) => trackArrivals(a, failingKeys, Date.now()));
  }, [data !== null, failingKeys.join("|")]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [details, setDetails] = useState<RunDetails | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [view, setView] = useState<OverlayView>("passed");
  const request = useRef(0);
  const open = (key: string, from: "failures" | "running" | "monitored") => {
    const e = entries.find((x) => x.key === key);
    if (!e) return;
    const v = viewFor(e, from);
    const run = v === "running" ? e.current : (e.latestCompleted ?? e.current);
    const id = ++request.current;
    setOpenKey(key);
    setView(v);
    setDetails(null);
    const q = run ? `?run=${run.id}` : "";
    fetch(`/api/entries/${encodeURIComponent(key)}/details${q}`)
      .then((r) => (r.ok ? r.json() : null))
      // a slow answer for an earlier click must not fill this overlay
      .then((d) => id === request.current && setDetails(d))
      .catch(() => id === request.current && setDetails(null));
  };
  const bandOf = (key: string): "failures" | "running" | "monitored" => {
    if (bands.failing.some((x) => x.key === key)) return "failures";
    return running.some((x) => x.key === key) ? "running" : "monitored";
  };
  const close = () => {
    setOpenKey(null);
    setFocusKey(null);
  };
  const countdown = useAutoClose(openKey !== null || focusKey !== null, close);
  const openEntry = entries.find((e) => e.key === openKey);
  const order = [
    ...bands.failing,
    ...running.filter((e) => !bands.failing.includes(e)),
    ...bands.monitored,
  ].map((e) => e.key);
  const orderKey = order.join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: order changes are tracked through orderKey
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const dir = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" }[
        ev.key
      ] as "up" | "down" | "left" | "right" | undefined;
      if (dir) setFocusKey((k) => moveFocus(order, k, dir));
      else if (ev.key === "Enter" && focusKey) open(focusKey, bandOf(focusKey));
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
          <Header
            entries={entries}
            title={data?.title}
            now={now}
            staleMinutes={stale}
            warnings={data?.warnings}
          />
          <LayoutGroup>
            <div className="body">
              {plan?.failures ? (
                <FailureBand
                  entries={bands.failing}
                  plan={plan.failures}
                  now={now}
                  onOpen={(k) => open(k, "failures")}
                  isFresh={(k) => isFresh(arrivals, k, now)}
                />
              ) : null}
              {plan?.running ? (
                <RunningArea
                  entries={running}
                  plan={plan.running}
                  now={now}
                  onOpen={(k) => open(k, "running")}
                  pinnedKey={openEntry && view === "running" ? openEntry.key : undefined}
                  heldUntil={held}
                />
              ) : null}
              {plan && (plan.empty || plan.monitored.height >= 64) ? (
                <MonitoredBand
                  entries={bands.monitored}
                  plan={plan.monitored}
                  page={page}
                  now={now}
                  onOpen={(k) => open(k, "monitored")}
                  allEmpty={plan.empty}
                  connecting={data?.synced === false}
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
            view={view}
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
