/**
 * Minimal ANSI styling. Colour is on only for a TTY, and off when `NO_COLOR` is set
 * (https://no-color.org) or `--no-color` is passed.
 */

let enabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

export function setColorEnabled(on: boolean): void {
  enabled = on;
}

export function colorEnabled(): boolean {
  return enabled;
}

function wrap(open: number, close: number) {
  return (text: string): string => (enabled ? `\x1b[${open}m${text}\x1b[${close}m` : text);
}

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const cyan = wrap(36, 39);
