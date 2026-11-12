/**
 * In-memory dashboard state. A source feeds it raw entry inputs; it derives what the wall
 * shows and notifies subscribers (the SSE connections).
 */
import { deriveEntry } from "../core/state.ts";
import { expectedDuration } from "../core/timing.ts";
import type { DashboardState, EntryInput } from "../core/types.ts";

export interface DisplaySettings {
  lowPower: "auto" | "on" | "off";
  demo: boolean;
  /** How long a run that just finished stays big on the wall (seconds). */
  holdFailedSeconds?: number;
  holdPassedSeconds?: number;
  /** How much faster run timestamps age than real time (the demo's fast clock), default 1. */
  clockScale?: number;
}

/** synced: the source has delivered its first full picture (until then: "connecting"). */
export type HubState = DashboardState & { display: DisplaySettings; synced: boolean };

export class Hub {
  ready = false;
  private state: HubState;
  private json = "";
  private fingerprint = "";
  private readonly subscribers = new Set<(json: string) => void>();

  constructor(
    readonly version: string,
    display: DisplaySettings = { lowPower: "auto", demo: false },
    title?: string,
    private readonly now: () => number = Date.now,
  ) {
    this.state = {
      version,
      generatedAt: new Date().toISOString(),
      title,
      entries: [],
      warnings: [],
      display,
      synced: false,
    };
  }

  update(inputs: EntryInput[]): void {
    // a pass is held big for a while (see web/holds.ts); a little extra covers clock skew
    const d = this.state.display;
    const heldMs = ((d.holdPassedSeconds ?? 45) + 15) * 1000 * (d.clockScale ?? 1);
    const entries = inputs.map((input) => {
      const view = deriveEntry(input);
      const last = view.latestCompleted;
      // the wall needs a finished run's jobs only while it fails (how far it got) or is held;
      // overlays fetch details on demand
      const keep =
        view.failing ||
        (last?.completedAt !== null &&
          last?.completedAt !== undefined &&
          this.now() - Date.parse(last.completedAt) < heldMs);
      return {
        ...view,
        latestCompleted: last ? { ...last, jobs: keep ? last.jobs : [] } : undefined,
        expectedMs: expectedDuration(input.runs),
      };
    });
    // nothing changed: no broadcast (every screen would re-parse and re-render for nothing)
    const fingerprint = JSON.stringify(entries);
    const changed = fingerprint !== this.fingerprint || !this.ready;
    this.fingerprint = fingerprint;
    this.ready = true;
    if (!changed) return;
    this.state = { ...this.state, entries, synced: true, generatedAt: new Date().toISOString() };
    this.broadcast();
  }

  /** Problems worth showing on the wall (rate limits, GitHub unreachable). */
  setWarnings(warnings: string[]): void {
    if (JSON.stringify(warnings) === JSON.stringify(this.state.warnings)) return;
    this.state = { ...this.state, warnings };
    this.broadcast();
  }

  private broadcast(): void {
    this.json = JSON.stringify(this.state);
    for (const fn of this.subscribers) fn(this.json);
  }

  /** The current snapshot as JSON, serialised once for all subscribers. */
  serialized(): string {
    if (!this.json) this.json = JSON.stringify(this.state);
    return this.json;
  }

  subscriberCount(): number {
    return this.subscribers.size;
  }

  snapshot(): HubState {
    return this.state;
  }

  subscribe(fn: (json: string) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }
}
