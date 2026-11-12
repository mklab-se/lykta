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
}

export type HubState = DashboardState & { display: DisplaySettings };

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
  ) {
    this.state = {
      version,
      generatedAt: new Date().toISOString(),
      title,
      entries: [],
      warnings: [],
      display,
    };
  }

  update(inputs: EntryInput[]): void {
    const entries = inputs.map((input) => {
      const view = deriveEntry(input);
      return {
        ...view,
        // the wall only needs the jobs of a running run; overlays fetch details on demand
        latestCompleted: view.latestCompleted ? { ...view.latestCompleted, jobs: [] } : undefined,
        expectedMs: expectedDuration(input.runs),
      };
    });
    // nothing changed: no broadcast (every screen would re-parse and re-render for nothing)
    const fingerprint = JSON.stringify(entries);
    const changed = fingerprint !== this.fingerprint || !this.ready;
    this.fingerprint = fingerprint;
    this.ready = true;
    if (!changed) return;
    this.state = { ...this.state, entries, generatedAt: new Date().toISOString() };
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
