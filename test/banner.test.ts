import { expect, test } from "bun:test";
import { FONT, renderBanner } from "../src/banner.ts";
import { TOOL } from "../src/meta.ts";

test("every glyph has 5 rows of equal width", () => {
  for (const [ch, rows] of Object.entries(FONT)) {
    expect(rows.length, ch).toBe(5);
    expect(new Set(rows.map((r) => [...r].length)).size, ch).toBe(1);
  }
});

test("the tool name renders as 5 non-empty lines", () => {
  const lines = renderBanner(TOOL);
  expect(lines).toHaveLength(5);
  for (const line of lines) expect(line.trim().length).toBeGreaterThan(0);
});

test("every character of the tool name has a glyph", () => {
  for (const ch of TOOL.toUpperCase()) expect(FONT[ch], ch).toBeDefined();
});
