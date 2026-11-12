import { useEffect, useState } from "react";
import { useVirtualCanvas } from "./canvas.ts";
import { Header } from "./components/Header.tsx";
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

  return (
    <div className="canvas" style={{ height: canvas.height, transform: `scale(${canvas.scale})` }}>
      <div className="drift">
        <div className="screen">
          <Header
            entries={data?.entries ?? []}
            title={data?.title}
            now={now}
            staleMinutes={stale}
          />
          <div className="body" />
        </div>
      </div>
    </div>
  );
}
