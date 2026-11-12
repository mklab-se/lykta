# Track and Pit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Command Center bands with the track (fixed grid of all workflows), the pit
(failures) and the spotlight (running workflows in turn).

**Architecture:** Server and data model are unchanged. The web side gets two pure modules
(`track.ts` for geometry, `spotlight.ts` for timing and pit entry) and three components (`Track`,
`Pit`, `Spotlight`); the failure band, running area, monitored band and holds go.

**Spec:** `docs/superpowers/specs/2026-11-12-lykta-dashboard-design.md` section 3.2.

## Global Constraints

- No em-dashes anywhere. Only `transform`/`opacity`/`filter` animate. Bun latest, TypeScript strict.
- Positions never change because the pit opens: the grid shape is computed for the full width.

## Tasks

1. `src/web/track.ts`: `gridShape(n, width, height)` → `{columns, rows}` (best tile size at about
   2.2:1); `pitWidth(failures, width)` (0, else 30% clamped 480-640); `pitMode(n, height)` →
   card / compact / row; `trackLayout(state, canvas, pitCount)` → tile width/height and unit.
   Tests: shape is stable when the pit opens; gaps keep slots; pit sizes.
2. `src/web/spotlight.ts`: `nextSpotlight(state, input, now, timings)` (running round robin,
   finished runs first, show/gap timings) and `inPit(e, finalsShown, now)` (a failure enters the
   pit once its last spotlight turn has been shown, or at once when it is not recent). Tests.
3. Settings: `display.spotlightSeconds` (8) and `display.spotlightEverySeconds` (20) replace the
   hold settings; the hub keeps a finished run's jobs for 2 minutes (× clockScale).
4. Components `Tile`/`Track`, `Pit`, `Spotlight` (run card extracted from `RunningArea`), new `App`
   and CSS. Server-rendered tests for each.
5. Remove `FailureBand`, `RunningArea`, `MonitoredBand`, `holds.ts`, `layout.ts` and their tests;
   README, CHANGELOG, CLAUDE.md.
6. Verify in the demo and on the live wall.

## Review Focus

- 1 and 100 workflows; 0, 1 and 20 failures; nothing running; 15 running.
- A workflow that fails while its spotlight is open; one restarted from the pit.
