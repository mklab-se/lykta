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
  private readonly subscribers = new Set<(s: HubState) => void>();

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
    this.state = { ...this.state, entries, generatedAt: new Date().toISOString() };
    this.ready = true;
    for (const fn of this.subscribers) fn(this.state);
  }

  snapshot(): HubState {
    return this.state;
  }

  subscribe(fn: (s: HubState) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }
}
