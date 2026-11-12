/**
 * The last results of a workflow as a timeline: always 10 slots, newest on the right, older
 * ones fading. Slots without a run yet are dotted boxes that fill in as runs happen, so every
 * workflow's strip has the same size and reads the same way.
 */

export const HISTORY_SLOTS = 10;

/** Older results fade (oldest slot 0.2), so the strip reads as a timeline ending in now. */
export function historyOpacity(i: number, n: number): number {
  if (n <= 1 || i >= n - 1) return 1;
  return Math.round((0.2 + (0.8 * i) / (n - 1)) * 100) / 100;
}

export function History(props: { history: ("p" | "f")[] }) {
  const results = props.history.slice(-HISTORY_SLOTS);
  const empty = HISTORY_SLOTS - results.length;
  return (
    <div className="hist">
      {Array.from({ length: HISTORY_SLOTS }, (_, slot) => {
        const r = slot >= empty ? results[slot - empty] : undefined;
        // biome-ignore lint/suspicious/noArrayIndexKey: the strip is positional (oldest to newest)
        if (!r) return <i key={`e${slot}`} className="e" />;
        const latest = slot === HISTORY_SLOTS - 1;
        return (
          <i
            // biome-ignore lint/suspicious/noArrayIndexKey: the strip is positional (oldest to newest)
            key={`r${slot}`}
            className={latest ? `${r} latest` : r}
            style={{ opacity: historyOpacity(slot, HISTORY_SLOTS) }}
          />
        );
      })}
    </div>
  );
}
