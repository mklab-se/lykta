/**
 * The dashboard's connection to the server: Server-Sent Events with reconnect, a reload
 * when the server's version changes (new deployment), and a nightly safety reload.
 */
import { useEffect, useReducer } from "react";
import type { DashboardState } from "../core/types.ts";

export type DisplaySettings = { lowPower: "auto" | "on" | "off"; demo: boolean };
export type ClientState = DashboardState & { display?: DisplaySettings; synced?: boolean };

export interface StreamState {
  data: ClientState | null;
  connected: boolean;
  lastMessageAt: number;
  firstVersion: string | null;
  reload: boolean;
}

export type StreamEvent =
  | { type: "snapshot"; data: ClientState; at: number }
  | { type: "ping"; at: number }
  | { type: "disconnected" };

export const STALE_MS = 180_000;

export function initialStream(): StreamState {
  return { data: null, connected: false, lastMessageAt: 0, firstVersion: null, reload: false };
}

export function reduceStream(s: StreamState, ev: StreamEvent): StreamState {
  switch (ev.type) {
    case "snapshot": {
      const firstVersion = s.firstVersion ?? ev.data.version;
      return {
        data: ev.data,
        connected: true,
        lastMessageAt: ev.at,
        firstVersion,
        reload: ev.data.version !== firstVersion,
      };
    }
    case "ping":
      return { ...s, connected: true, lastMessageAt: ev.at };
    case "disconnected":
      return { ...s, connected: false };
  }
}

/** True when nothing has been heard from the server for `thresholdMs`. */
export function isStale(s: StreamState, now: number, thresholdMs = STALE_MS): boolean {
  return s.data !== null && now - s.lastMessageAt > thresholdMs;
}

/** Milliseconds until the next 04:00 local time. */
export function msUntilNightlyReload(now: Date): number {
  const next = new Date(now);
  next.setHours(4, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * The nightly safety reload only happens when the server answers; reloading into a dead
 * server would leave the kiosk on the browser's error page with nothing to bring it back.
 */
export async function reloadWhenHealthy(deps: {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  reload: () => void;
  retryLater: () => void;
}): Promise<void> {
  try {
    const res = await deps.fetch("/healthz", { cache: "no-store" });
    if (res.ok) {
      deps.reload();
      return;
    }
  } catch {
    // offline: fall through and try again later
  }
  deps.retryLater();
}

const RELOAD_RETRY_MS = 3 * 60_000;

export function useDashboard(url = "/events"): StreamState {
  const [state, dispatch] = useReducer(reduceStream, undefined, initialStream);

  useEffect(() => {
    let source: EventSource | null = null;
    let retry = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const connect = () => {
      source = new EventSource(url);
      source.addEventListener("snapshot", (e) => {
        retry = 1000;
        dispatch({ type: "snapshot", data: JSON.parse((e as MessageEvent).data), at: Date.now() });
      });
      source.addEventListener("ping", () => dispatch({ type: "ping", at: Date.now() }));
      source.onerror = () => {
        source?.close();
        dispatch({ type: "disconnected" });
        if (closed) return;
        timer = setTimeout(connect, retry);
        retry = Math.min(30_000, retry * 2);
      };
    };
    connect();
    let nightly: ReturnType<typeof setTimeout>;
    const tryReload = () =>
      reloadWhenHealthy({
        fetch: (input, init) => fetch(input, init),
        reload: () => location.reload(),
        retryLater: () => {
          nightly = setTimeout(tryReload, RELOAD_RETRY_MS);
        },
      });
    nightly = setTimeout(tryReload, msUntilNightlyReload(new Date()));
    return () => {
      closed = true;
      source?.close();
      clearTimeout(timer);
      clearTimeout(nightly);
    };
  }, [url]);

  useEffect(() => {
    if (state.reload) location.reload();
  }, [state.reload]);

  return state;
}
