/**
 * Which running workflow the detail panel shows: the highlight walks down the list,
 * wraps around, and jumps to a run where something just happened.
 */

export interface Selection {
  selectedKey: string | null;
  selectedAt: number;
}

/** Seconds on each workflow: longer when fewer run (6 to 12). */
export function dwellSeconds(n: number): number {
  return Math.max(6, Math.min(12, 30 / Math.max(1, n)));
}

export function nextSelection(
  s: Selection,
  runningKeys: string[],
  now: number,
  jumpTo?: string,
): Selection {
  if (runningKeys.length === 0) return { selectedKey: null, selectedAt: now };
  if (jumpTo && runningKeys.includes(jumpTo)) return { selectedKey: jumpTo, selectedAt: now };
  const idx = s.selectedKey ? runningKeys.indexOf(s.selectedKey) : -1;
  if (idx < 0) return { selectedKey: runningKeys[0] ?? null, selectedAt: now };
  if (now - s.selectedAt < dwellSeconds(runningKeys.length) * 1000) return s;
  return { selectedKey: runningKeys[(idx + 1) % runningKeys.length] ?? null, selectedAt: now };
}
