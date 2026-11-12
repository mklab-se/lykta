/**
 * Interaction falls back to the default view after a minute without input (spec 3.7).
 */
import { useEffect, useRef, useState } from "react";

export const IDLE_MS = 60_000;
const COUNTDOWN_FROM_MS = 10_000;

export function idleRemaining(lastInputAt: number, now: number, timeoutMs = IDLE_MS): number {
  return Math.max(0, timeoutMs - (now - lastInputAt));
}

/** While `open`, closes after a minute without input; returns seconds left in the last 10 s, else null. */
export function useAutoClose(open: boolean, onClose: () => void): number | null {
  const last = useRef(Date.now());
  const [left, setLeft] = useState<number | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) {
      setLeft(null);
      return;
    }
    last.current = Date.now();
    const bump = () => {
      last.current = Date.now();
    };
    const events = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, bump);
    const t = setInterval(() => {
      const rem = idleRemaining(last.current, Date.now());
      if (rem === 0) close.current();
      setLeft(rem <= COUNTDOWN_FROM_MS ? Math.ceil(rem / 1000) : null);
    }, 1000);
    return () => {
      for (const e of events) window.removeEventListener(e, bump);
      clearInterval(t);
    };
  }, [open]);
  return left;
}
