/**
 * Where dashboard data comes from. The GitHub poller (plan 2) and the demo simulation
 * implement the same interface, so the rest of the system cannot tell them apart.
 */
import type { EntryInput, JobRecord } from "../core/types.ts";

export interface RunDetails {
  entryKey: string;
  runUrl: string;
  logExcerpt: string[];
  jobs: JobRecord[];
}

export interface Source {
  start(onChange: (inputs: EntryInput[]) => void): void;
  stop(): void;
  details(entryKey: string): Promise<RunDetails | null>;
}
