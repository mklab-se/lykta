import { AnimatePresence, LayoutGroup } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { RunDetails } from "../server/source.ts";
import { emptyArrivals, isFresh, trackArrivals } from "./arrivals.ts";
import { useVirtualCanvas } from "./canvas.ts";
import { DemoControls } from "./components/DemoControls.tsx";
import { DetailOverlay, type OverlayView, viewFor } from "./components/DetailOverlay.tsx";
import { Header } from "./components/Header.tsx";
import { Pit } from "./components/Pit.tsx";
import { Spotlight } from "./components/Spotlight.tsx";
import { Track } from "./components/Track.tsx";
import { moveFocus } from "./focus.ts";
import { useAutoClose } from "./idle.ts";
import { usePowerMode } from "./power.ts";
import { emptySpotlight, inPit, nextSpotlight, type Timings } from "./spotlight.ts";
import { isStale, useDashboard } from "./stream.ts";
import { GAP, singleRepo, trackLayout } from "./track.ts";

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
  const display = data?.display;
  const timings: Timings = {
    showMs: (display?.spotlightSeconds ?? 8) * 1000,
    everyMs: (display?.spotlightEverySeconds ?? 20) * 1000,
    clockScale: display?.clockScale ?? 1,
  };

  // the spotlight advances once per clock tick; a workflow enters the pit after its last turn
  const [spot, setSpot] = useState(emptySpotlight);
  // biome-ignore lint/correctness/useExhaustiveDependencies: advance once per clock tick
  useEffect(() => {
    if (data) setSpot((s) => nextSpotlight(s, entries, now, timings));
  }, [now, data !== null]);
  const pitEntries = entries.filter((e) => inPit(e, spot, now, timings));
  const pitKeys = new Set(pitEntries.map((e) => e.key));
  const layout = trackLayout(entries.length, pitEntries.length, canvas);
  const spotEntry = spot.current ? entries.find((e) => e.key === spot.current?.key) : undefined;

  const [arrivals, setArrivals] = useState(emptyArrivals);
  const pitKey = pitEntries.map((e) => e.key).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: track when the pit's members change
  useEffect(() => {
    if (data) setArrivals((a) => trackArrivals(a, [...pitKeys], Date.now()));
  }, [data !== null, pitKey]);

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [details, setDetails] = useState<RunDetails | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [view, setView] = useState<OverlayView>("passed");
  const request = useRef(0);
  const open = (key: string) => {
    const e = entries.find((x) => x.key === key);
    if (!e) return;
    const from = pitKeys.has(key) ? "failures" : e.state === "running" ? "running" : "monitored";
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
  const close = () => {
    setOpenKey(null);
    setFocusKey(null);
  };
  const countdown = useAutoClose(openKey !== null || focusKey !== null, close);
  const openEntry = entries.find((e) => e.key === openKey);
  // keyboard focus walks the pit, then the track in slot order
  const order = [...pitEntries, ...entries.filter((e) => !pitKeys.has(e.key))].map((e) => e.key);
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
  const lowPower = usePowerMode(display?.lowPower ?? "auto");
  const trackLeft = layout.pit.width ? layout.pit.width + GAP : 0;

  return (
    <div
      className="canvas"
      data-power={lowPower ? "low" : "full"}
      data-single-repo={singleRepo(entries) ? "" : undefined}
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
            <div className="stage" style={{ height: layout.height }}>
              <AnimatePresence>
                {pitEntries.length ? (
                  <Pit
                    key="pit"
                    entries={pitEntries}
                    layout={layout}
                    now={now}
                    onOpen={open}
                    isFresh={(k) => isFresh(arrivals, k, now)}
                  />
                ) : null}
              </AnimatePresence>
              <div className="trackwrap" style={{ left: trackLeft }}>
                <Track
                  entries={entries}
                  pit={pitKeys}
                  layout={layout}
                  now={now}
                  onOpen={open}
                  dimmed={spotEntry !== undefined}
                  connecting={data?.synced === false}
                />
                <AnimatePresence>
                  {spotEntry && spot.current ? (
                    <Spotlight
                      key={`${spot.current.key}:${spot.shownAt}`}
                      e={spotEntry}
                      final={spot.current.final}
                      width={layout.gridWidth - 80}
                      height={layout.height - 60}
                      now={now}
                      onOpen={open}
                    />
                  ) : null}
                </AnimatePresence>
              </div>
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
      {display?.demo ? <DemoControls /> : null}
    </div>
  );
}
