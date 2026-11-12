/** Stable React keys for texts that can repeat (log lines, step names): text plus occurrence. */
export function uniqueKeys(texts: string[]): string[] {
  const seen = new Map<string, number>();
  return texts.map((t) => {
    const n = (seen.get(t) ?? 0) + 1;
    seen.set(t, n);
    return `${n}:${t}`;
  });
}
