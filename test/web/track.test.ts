import { describe, expect, test } from "bun:test";
import { gridShape, pitMode, pitWidth, trackLayout } from "../../src/web/track.ts";

const W = 1840;
const H = 970;

describe("track geometry", () => {
  test("grid shape: the biggest tiles that fit, about twice as wide as tall", () => {
    expect(gridShape(9, W, H)).toEqual({ columns: 3, rows: 3 });
    expect(gridShape(1, W, H)).toEqual({ columns: 1, rows: 1 });
    const big = gridShape(100, W, H);
    expect(big.columns * big.rows).toBeGreaterThanOrEqual(100);
    expect(gridShape(0, W, H)).toEqual({ columns: 1, rows: 1 });
  });

  test("the pit only exists with failures, and takes about 30% of the width", () => {
    expect(pitWidth(0, W)).toBe(0);
    expect(pitWidth(1, W)).toBe(552);
    expect(pitWidth(3, 1000)).toBe(480);
  });

  test("pit cards get more compact as the pit fills", () => {
    expect(pitMode(2, H).mode).toBe("card");
    expect(pitMode(5, H).mode).toBe("compact");
    const many = pitMode(30, H);
    expect(many.mode).toBe("row");
    expect(many.shown + many.hidden).toBe(30);
    expect(many.hidden).toBeGreaterThan(0);
  });

  test("opening the pit keeps the grid's shape: tiles get narrower, never move rows", () => {
    const calm = trackLayout(15, 0, { width: 1920, height: 1080 });
    const pit = trackLayout(15, 2, { width: 1920, height: 1080 });
    expect(pit.columns).toBe(calm.columns);
    expect(pit.rows).toBe(calm.rows);
    expect(pit.tileHeight).toBe(calm.tileHeight);
    expect(pit.tileWidth).toBeLessThan(calm.tileWidth);
    expect(pit.pit.width).toBeGreaterThan(0);
    expect(calm.pit.width).toBe(0);
  });

  test("tile detail follows tile size", () => {
    expect(trackLayout(6, 0, { width: 1920, height: 1080 }).unit).toBe("big");
    expect(["small", "tiny"]).toContain(trackLayout(100, 0, { width: 1920, height: 1080 }).unit);
  });
});
