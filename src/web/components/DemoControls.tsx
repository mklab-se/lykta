import { useEffect, useState } from "react";

const HIDE_MS = 3500;
const RUNNING = [0, 2, 5, 12];

/** Demo mode only: a bar that appears on mouse movement to steer the simulation. */
export function DemoControls() {
  const [visible, setVisible] = useState(false);
  const [running, setRunning] = useState<number | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const show = () => {
      setVisible(true);
      clearTimeout(t);
      t = setTimeout(() => setVisible(false), HIDE_MS);
    };
    window.addEventListener("mousemove", show);
    return () => {
      window.removeEventListener("mousemove", show);
      clearTimeout(t);
    };
  }, []);
  const post = (path: string) => fetch(path, { method: "POST" });
  return (
    <div className={`democtl${visible ? "" : " hidden"}`}>
      <span>Demo · running</span>
      {RUNNING.map((n) => (
        <button
          type="button"
          key={n}
          className={running === n ? "on" : undefined}
          onClick={() => {
            setRunning(n);
            post(`/api/demo/running/${n}`);
          }}
        >
          {n}
        </button>
      ))}
      <button type="button" onClick={() => post("/api/demo/break")}>
        Break one
      </button>
    </div>
  );
}
