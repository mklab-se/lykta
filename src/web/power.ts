/**
 * Low-power mode for weak screens (Raspberry Pi, TV sticks): when frames are slow, drop the
 * decorative motion (drift, flowing edges, glow) and keep the morphs and state changes.
 */
import { useEffect, useState } from "react";

const SLOW_FRAME_MS = 20;
const MIN_FRAMES = 60;
const SAMPLE_MS = 10_000;
const RECHECK_MS = 10 * 60_000;

export function shouldUseLowPower(
  frameTimesMs: number[],
  forced: "auto" | "on" | "off",
  alreadyLow = false,
): boolean {
  if (forced !== "auto") return forced === "on";
  // dropping effects makes frames faster; switching back would flap every recheck
  if (alreadyLow) return true;
  const recent = frameTimesMs.slice(-120);
  if (recent.length < MIN_FRAMES) return false;
  const sorted = [...recent].sort((a, b) => a - b);
  return (sorted[Math.floor(sorted.length / 2)] ?? 0) > SLOW_FRAME_MS;
}

/** Samples frame times for 10 s after load and then every 10 minutes. */
export function usePowerMode(forced: "auto" | "on" | "off"): boolean {
  const [low, setLow] = useState(forced === "on");
  useEffect(() => {
    if (forced !== "auto") {
      setLow(forced === "on");
      return;
    }
    let raf = 0;
    let timer: ReturnType<typeof setTimeout>;
    const sample = () => {
      const times: number[] = [];
      let last = performance.now();
      const end = last + SAMPLE_MS;
      const frame = (t: number) => {
        times.push(t - last);
        last = t;
        if (t < end) raf = requestAnimationFrame(frame);
        else {
          // a hidden tab pauses frames; only trust samples taken while visible
          if (document.visibilityState === "visible")
            setLow((was) => shouldUseLowPower(times, "auto", was));
          timer = setTimeout(sample, RECHECK_MS);
        }
      };
      raf = requestAnimationFrame(frame);
    };
    sample();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [forced]);
  return low;
}
