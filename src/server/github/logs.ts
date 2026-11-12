/**
 * Turns a GitHub job log into the few lines worth showing on a failure card: the failing
 * step's own section, around its first error.
 */

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, "g");
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;
const MARKER = /^##\[(\w+)\]/;

/** Strips the BOM, ANSI colour codes and the timestamp GitHub puts on every line. */
export function cleanLog(raw: string): string[] {
  const lines = raw
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.replace(ANSI, "").replace(TIMESTAMP, ""));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const isStepStart = (l: string) => l.startsWith("##[group]Run ");

/** GitHub's closing line for every failed run step; it says nothing about what failed. */
const EXIT_LINE = /^##\[error\]Process completed with exit code \d+\.?$/;

/** Display lines: group markers and the exit-code line dropped, "##[error]" prefixes removed. */
function present(lines: string[]): { text: string; error: boolean }[] {
  return lines
    .filter((l) => !l.startsWith("##[group]") && !l.startsWith("##[endgroup]"))
    .filter((l) => !EXIT_LINE.test(l))
    .map((l) => {
      const m = l.match(MARKER);
      return { text: m ? l.slice(m[0].length) : l, error: m?.[1] === "error" };
    });
}

/** Lines leading up to the first error, ending with the error lines themselves. */
function around(lines: { text: string; error: boolean }[], max: number): string[] {
  const firstError = lines.findIndex((l) => l.error);
  if (firstError < 0) return lines.slice(-max).map((l) => l.text);
  // include the run of error lines that follows, but never what comes after it (cleanup)
  let end = firstError + 1;
  while (end < lines.length && lines[end]?.error) end++;
  return lines.slice(Math.max(0, end - max), end).map((l) => l.text);
}

export function failureExcerpt(lines: string[], failedStep: string, max = 12): string[] {
  const start = lines.findIndex(
    (l) => l === `##[group]${failedStep}` || l === `##[group]Run ${failedStep}`,
  );
  if (start < 0) return around(present(lines), max);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isStepStart(lines[i] as string)) {
      end = i;
      break;
    }
  }
  return around(present(lines.slice(start, end)), max);
}
