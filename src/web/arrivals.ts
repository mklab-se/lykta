/**
 * The screen's own memory of events. "Something just happened" is judged by when this screen
 * first saw it, not by server timestamps (which lag behind polling).
 */

const PULSE_MS = 2_000;

export interface Arrivals {
  seeded: boolean;
  known: Set<string>;
  arrived: Map<string, number>;
}

export function emptyArrivals(): Arrivals {
  return { seeded: false, known: new Set(), arrived: new Map() };
}

/** Failures already on screen at start are known without a pulse; later ones arrive now. */
export function trackArrivals(prev: Arrivals, failingKeys: string[], now: number): Arrivals {
  const known = new Set(failingKeys);
  const arrived = new Map<string, number>();
  for (const [k, t] of prev.arrived) if (known.has(k) && now - t < PULSE_MS) arrived.set(k, t);
  if (prev.seeded) for (const k of failingKeys) if (!prev.known.has(k)) arrived.set(k, now);
  return { seeded: true, known, arrived };
}

export function isFresh(a: Arrivals, key: string, now: number): boolean {
  const t = a.arrived.get(key);
  return t !== undefined && now - t < PULSE_MS;
}
