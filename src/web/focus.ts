/**
 * Keyboard focus walks the on-screen order (failures, running list, monitored) and wraps.
 */
export function moveFocus(
  keys: string[],
  current: string | null,
  dir: "up" | "down" | "left" | "right",
): string | null {
  if (keys.length === 0) return null;
  const idx = current ? keys.indexOf(current) : -1;
  if (idx < 0) return keys[0] ?? null;
  const step = dir === "up" || dir === "left" ? -1 : 1;
  return keys[(idx + step + keys.length) % keys.length] ?? null;
}
