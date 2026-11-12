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
const EXIT_LINE = /^(##\[error\]|Error: )?Process completed with exit code \d+\.?$/;

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

/** The failing step's own section, or the whole log when the step cannot be found. */
function section(lines: string[], failedStep: string): string[] {
  const start = lines.findIndex(
    (l) => l === `##[group]${failedStep}` || l === `##[group]Run ${failedStep}`,
  );
  if (start < 0) return lines;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isStepStart(lines[i] as string)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end);
}

export function failureExcerpt(lines: string[], failedStep: string, max = 12): string[] {
  return around(present(section(lines, failedStep)), max);
}

/** "error" or "fatal" as a word, or Kotlin's "e: " prefix. */
const ERROR_WORD = /\b(error|fatal)\b|^e: /i;

/**
 * The error message itself, for the biggest text on a failure card: lines GitHub flags as
 * errors and compiler-style "error:" lines, never the script that printed them (shown in a
 * step's opening group) and never the generic exit-code line. The first `max` distinct
 * lines: the first error is usually the cause, later ones follow-ups and summaries.
 */
export function failureErrors(lines: string[], failedStep: string, max = 3): string[] {
  const found: string[] = [];
  let inGroup = false;
  for (const l of section(lines, failedStep)) {
    if (l.startsWith("##[group]")) {
      inGroup = true;
      continue;
    }
    if (l.startsWith("##[endgroup]")) {
      inGroup = false;
      continue;
    }
    if (inGroup || EXIT_LINE.test(l)) continue;
    const m = l.match(MARKER);
    const text = m ? l.slice(m[0].length) : l;
    if ((m?.[1] === "error" || (!m && ERROR_WORD.test(l))) && !found.includes(text)) {
      found.push(text);
      if (found.length === max) break;
    }
  }
  return found;
}
