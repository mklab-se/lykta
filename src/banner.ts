/**
 * Block-letter banner, rendered at runtime from the tool name, so renaming the
 * tool needs no hand-drawn ASCII art. Unknown characters are skipped.
 */
import { bold, dim } from "./color.ts";
import { DESCRIPTION, TOOL, VERSION } from "./meta.ts";

/** A 5-row block font. Every glyph's rows share one width. */
export const FONT: Record<string, readonly string[]> = {
  A: [" ██ ", "█  █", "████", "█  █", "█  █"],
  B: ["███ ", "█  █", "███ ", "█  █", "███ "],
  C: [" ███", "█   ", "█   ", "█   ", " ███"],
  D: ["███ ", "█  █", "█  █", "█  █", "███ "],
  E: ["████", "█   ", "███ ", "█   ", "████"],
  F: ["████", "█   ", "███ ", "█   ", "█   "],
  G: [" ███", "█   ", "█ ██", "█  █", " ███"],
  H: ["█  █", "█  █", "████", "█  █", "█  █"],
  I: ["███", " █ ", " █ ", " █ ", "███"],
  J: ["  ██", "   █", "   █", "█  █", " ██ "],
  K: ["█  █", "█ █ ", "██  ", "█ █ ", "█  █"],
  L: ["█   ", "█   ", "█   ", "█   ", "████"],
  M: ["█   █", "██ ██", "█ █ █", "█   █", "█   █"],
  N: ["█   █", "██  █", "█ █ █", "█  ██", "█   █"],
  O: [" ██ ", "█  █", "█  █", "█  █", " ██ "],
  P: ["███ ", "█  █", "███ ", "█   ", "█   "],
  Q: [" ██ ", "█  █", "█  █", "█ ██", " ███"],
  R: ["███ ", "█  █", "███ ", "█ █ ", "█  █"],
  S: [" ███", "█   ", " ██ ", "   █", "███ "],
  T: ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
  U: ["█  █", "█  █", "█  █", "█  █", " ██ "],
  V: ["█   █", "█   █", "█   █", " █ █ ", "  █  "],
  W: ["█   █", "█   █", "█ █ █", "██ ██", "█   █"],
  X: ["█   █", " █ █ ", "  █  ", " █ █ ", "█   █"],
  Y: ["█   █", " █ █ ", "  █  ", "  █  ", "  █  "],
  Z: ["████", "   █", "  █ ", " █  ", "████"],
  "0": [" ██ ", "█  █", "█  █", "█  █", " ██ "],
  "1": [" █ ", "██ ", " █ ", " █ ", "███"],
  "2": ["███ ", "   █", " ██ ", "█   ", "████"],
  "3": ["███ ", "   █", " ██ ", "   █", "███ "],
  "4": ["█  █", "█  █", "████", "   █", "   █"],
  "5": ["████", "█   ", "███ ", "   █", "███ "],
  "6": [" ██ ", "█   ", "███ ", "█  █", " ██ "],
  "7": ["████", "   █", "  █ ", " █  ", " █  "],
  "8": [" ██ ", "█  █", " ██ ", "█  █", " ██ "],
  "9": [" ██ ", "█  █", " ███", "   █", " ██ "],
  "-": ["   ", "   ", "███", "   ", "   "],
  " ": ["  ", "  ", "  ", "  ", "  "],
};

/** Render `text` as 5 lines of block letters (2-space indent, 2-space letter gap). */
export function renderBanner(text: string): string[] {
  const glyphs = [...text.toUpperCase()]
    .map((ch) => FONT[ch])
    .filter((g): g is readonly string[] => g !== undefined);
  return [0, 1, 2, 3, 4].map((row) => `  ${glyphs.map((g) => g[row]).join("  ")}`.trimEnd());
}

export function printBanner(): void {
  for (const line of renderBanner(TOOL)) console.log(bold(line));
}

export function printBannerWithVersion(): void {
  printBanner();
  console.log(` ${dim(DESCRIPTION)} ${dim(`v${VERSION}`)}`);
  console.log();
}
