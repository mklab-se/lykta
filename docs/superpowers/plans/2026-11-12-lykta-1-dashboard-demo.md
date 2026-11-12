# Lykta Plan 1: Dashboard with demo mode, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `lykta demo` serves the complete Command Center dashboard, driven by a simulation, ready to
run for a day on a Raspberry Pi.

**Architecture:** Pure core logic in `src/core/` (state derivation, timing, job graph model) is shared by
the server and the browser. The server (`src/server/`) holds state in memory, gets it from a `Source`
(here the `DemoSource`), and pushes snapshots over Server-Sent Events. The browser app (`src/web/`,
React 19 + Motion) renders it with a pure layout function deciding densities.

**Tech Stack:** Bun (latest), TypeScript strict, React 19, Motion, commander, `bun test`, Biome,
`uqr` (QR codes), `@fontsource-variable/inter`, `@fontsource/jetbrains-mono`.

**Spec:** `docs/superpowers/specs/2026-11-12-lykta-dashboard-design.md` (read it first). Visual
reference: `docs/superpowers/specs/assets/command-center-mockup.html`; open it in a browser and copy
its look (colours, sizes, typography) and behaviour; its JavaScript is a throwaway prototype, not code
to port line by line.

**This is plan 1 of 3.** Plan 2: real GitHub data (config, auth, poller, workflow-file graph matching,
`serve`/`check`/`init`, live test workflows). Plan 3: container on ghcr.io, Helm chart, Argo CD,
docs. Do not start their work here.

## Global Constraints

- No em-dashes (U+2014) anywhere: code, comments, UI copy, tests, docs, commits. CI checks it.
- Bun and every dependency at the latest version (`bun add <pkg>@latest`); `bun outdated` lists nothing at the end.
- TypeScript strict (`tsc --noEmit` clean), Biome clean (`bun run lint`), `bun test` green; run `bun run check` before every commit.
- Palette (exact): background `#000`, red `#ff3d4d`, amber `#ffb224`, green `#2fe07f`, text `#e8edf3`, muted `#7d8794`, dim `#4a525d`. Fonts: Inter (UI), JetBrains Mono (logs, commits), bundled from `@fontsource*` packages, never fetched from the network.
- Animate only `transform` and `opacity`. No animated `filter`, `blur`, `box-shadow`. Glows are static gradients whose opacity animates.
- Live values (elapsed, progress) update at most once per second.
- Virtual canvas: width 1920 px, height `round(innerHeight / (innerWidth / 1920))`, scaled with `transform: scale(innerWidth / 1920)`.
- Server keeps all state in memory; nothing written to disk.
- `src/core/` imports nothing from `src/server/` or `src/web/`; it has no DOM or Bun-server APIs, so both sides can import it.
- Every new module gets a test file in `test/` (or `test/web/` for browser-side pure modules).

## Review Focus

1. A run that is queued with `startedAt` null, or a step with no times: never crash or show `NaN`; show "queued" and `0m`. Test in Task 2 (`timing handles missing start`) and Task 1 (`queued run is running`).
2. A job whose `needs` names a job that does not exist, or a dependency cycle: the graph must fall back without infinite recursion. Test in Task 3 (`missing need and cycle fall back to depth 0`).
3. The server restarts while a browser is connected: the client reconnects and replaces all state, and reloads when the version changed. Test in Task 6 (`reconnect replaces state`, `version change requests reload`).
4. Zero monitored entries: a calm "Nothing is monitored yet" screen, not an empty black page. Test in Task 7 (`empty state layout`) and Task 10 (`renders empty message`).
5. Very long workflow or repository names: ellipsis, never overflowing a card or pushing layout. Test in Task 8 (`long names are truncated with ellipsis class`).

---

### Task 1: Core model and entry state derivation

**Files:**
- Create: `src/core/types.ts`, `src/core/state.ts`
- Test: `test/core/state.test.ts`

**Interfaces:**
- Produces (types in `src/core/types.ts`):
  ```ts
  export type JobStatus = "queued" | "running" | "success" | "failure" | "skipped" | "cancelled";
  export type Conclusion = "success" | "failure" | "timed_out" | "startup_failure" | "cancelled" | "skipped" | "neutral" | "stale" | "action_required" | null;
  export type RunnerKind = "gh" | "k8s" | "lab" | "self";
  export interface RunnerInfo { kind: RunnerKind; label: string; detail?: string }
  export interface StepRecord { name: string; status: JobStatus; startedAt: string | null; completedAt: string | null }
  export interface JobRecord { id: string; name: string; status: JobStatus; needs: string[]; group?: string; runner?: RunnerInfo; steps: StepRecord[]; startedAt: string | null; completedAt: string | null }
  export interface RunRecord { id: number; url: string; branch: string; sha: string; actor: string; event: string; createdAt: string; startedAt: string | null; completedAt: string | null; status: "queued" | "in_progress" | "waiting" | "completed"; conclusion: Conclusion; jobs: JobRecord[] }
  export interface FailureInfo { job: string; step: string; runner?: RunnerInfo; logExcerpt: string[] }
  export interface MonitoredEntry { key: string; repo: string; workflow: string; branch: string; name: string }
  export interface EntryInput { entry: MonitoredEntry; runs: RunRecord[]; failure?: FailureInfo; problem?: string }
  export type EntryState = "never" | "passed" | "failed" | "running" | "missing";
  export interface EntryView { key: string; name: string; repo: string; branch: string; state: EntryState; failing: boolean; current?: RunRecord; latestCompleted?: RunRecord; failure?: FailureInfo; brokenSince?: string; history: ("p" | "f")[]; problem?: string; expectedMs?: number; lastDurationMs?: number }
  export interface DashboardState { version: string; generatedAt: string; title?: string; entries: EntryView[]; warnings: string[] }
  ```
- Produces (in `src/core/state.ts`): `deriveEntry(input: EntryInput): EntryView` and `isFailureConclusion(c: Conclusion): boolean`.

Rules (from spec 3.1): runs are newest first. Failure conclusions are exactly `failure`, `timed_out`, `startup_failure`. Completed runs with `cancelled`, `skipped`, `neutral`, `stale`, `action_required` are ignored for passed/failed. `state` = `missing` if `problem` is set; else `running` if the newest run is not `completed`; else `failed`/`passed` from the newest counted completed run; else `never`. `failing` is true when the newest counted completed run failed, even while `state` is `running` (a failing workflow being re-run shows in both bands). `brokenSince` = `completedAt` of the oldest failed run in the unbroken failing streak. `history` = up to 14 counted completed runs, oldest first. `lastDurationMs` = `completedAt - startedAt` of `latestCompleted`. `expectedMs` is filled by Task 2 helpers (leave `undefined` here).

- [ ] **Step 1: Write the failing tests** in `test/core/state.test.ts` with a `run(overrides)` builder:
  - `never run`: `runs: []` → `state "never"`, `history []`.
  - `passed`: newest completed `success` → `state "passed"`, `failing false`.
  - `failed conclusions`: each of `failure`, `timed_out`, `startup_failure` → `state "failed"`.
  - `ignored conclusions`: newest `cancelled` then older `success` → `state "passed"`; same for `skipped`, `neutral`, `stale`, `action_required`.
  - `queued run is running`: newest `status "queued"`, `startedAt null` → `state "running"`, `current.id` is that run.
  - `failing and re-running`: newest in progress, next `failure` → `state "running"`, `failing true`, `failure` kept.
  - `broken since`: runs newest-first `failure (t3)`, `failure (t2)`, `success (t1)` → `brokenSince` equals the t2 run's `completedAt`.
  - `history`: 20 completed runs → 14 entries, oldest first, `"f"` for failures.
  - `missing`: `problem: "404"` → `state "missing"`, `problem "404"`.
- [ ] **Step 2: Run** `bun test test/core/state.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the types and `deriveEntry` / `isFailureConclusion` per the rules above.
- [ ] **Step 4: Run** `bun test test/core/state.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/core test/core && git commit -m "core: entry model and state derivation"`

### Task 2: Timing: expected duration, slow detection, labels

**Files:**
- Create: `src/core/timing.ts`
- Test: `test/core/timing.test.ts`

**Interfaces:**
- Consumes: `RunRecord`, `JobRecord`, `StepRecord` (Task 1).
- Produces:
  - `expectedDuration(runs: RunRecord[]): number | undefined`: median of `completedAt - startedAt` over the newest 5 completed `success` runs; `undefined` if none.
  - `expectedJobDurations(runs: RunRecord[]): Map<string, number>`: per job name, median over the same 5 runs.
  - `runProgress(run: RunRecord, expectedMs: number | undefined, now: number): { elapsedMs: number; fraction: number | null; slow: boolean; etaMs: number | null }`: `elapsedMs = now - startedAt` (0 when `startedAt` null); `fraction = min(0.999, elapsed / expected)` or `null` without history; `slow` when `elapsed > 1.25 * expected`; `etaMs = now + max(0, expected - elapsed)` or `null`.
  - `isStepSlow(step: StepRecord, usualMs: number | undefined, now: number): boolean`: running step past `1.5 * usualMs`.
  - `formatDuration(ms: number): string`: `"45s"`, `"12m 05s"`, `"2h 14m"`.
  - `formatClock(epochMs: number, timeZone?: string): string`: `"17:40"` (24-hour, `sv-SE`).
- [ ] **Step 1: Write the failing tests**: `expected is median of last 5 successes` (durations 10,20,30,40,50,900 min where 900 is the oldest → 30 min); `no history gives undefined`; `slow at 125 percent` (expected 60 min, elapsed 76 min → `slow true`; 74 → `false`); `timing handles missing start` (`startedAt null` → `elapsedMs 0`, no `NaN`); `step slow at 150 percent`; `formatDuration` cases `45_000 → "45s"`, `725_000 → "12m 05s"`, `8_040_000 → "2h 14m"`; `formatClock(Date.UTC(2026,10,12,16,40), "UTC") → "16:40"`.
- [ ] **Step 2: Run** `bun test test/core/timing.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `src/core/timing.ts`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "core: expected durations, slow detection, time labels"`

### Task 3: Job graph model

**Files:**
- Create: `src/core/graph.ts`
- Test: `test/core/graph.test.ts`

**Interfaces:**
- Consumes: `JobRecord` (Task 1).
- Produces:
  ```ts
  export type NodeKind = "job" | "group" | "done" | "later";
  export interface GraphNode { id: string; kind: NodeKind; label: string; status: "queued" | "running" | "success" | "failure" | "skipped"; jobs: JobRecord[] }
  export interface GraphModel { columns: GraphNode[][]; edges: [from: string, to: string][] }
  export function buildGraph(jobs: JobRecord[], maxColumns: number): GraphModel;
  export function jobDepths(jobs: JobRecord[]): Map<string, number>;
  ```
Rules (spec 3.3): column = dependency depth (0 for no needs). Within a column, more than 3 jobs sharing `group` fold into one `group` node (`id "g-<group>"`, `label "<group> ×<n>"`). Node status: any failure → `failure`; any running, or a mix of success and queued → `running`; all success → `success`; all skipped → `skipped`; else `queued`. When columns exceed `maxColumns`: start one column before the first column that is not all `success`; finished columns before it fold into one `done` node (`label "<n> jobs done"`); columns that do not fit after fold into one `later` node (`label "+<n> jobs"`); at least one real column is always shown. Edges connect nodes (not jobs), deduplicated, never self-edges. Missing `needs` targets are ignored; a cycle must not recurse forever (treat a job on the current recursion path as depth 0).
- [ ] **Step 1: Write the failing tests**: `columns follow needs` (a → b,c → d gives 3 columns); `matrix folds above 3` (4 jobs group "Build" in one column → one node `"Build ×4"` with 4 jobs; 3 jobs stay separate); `group status` (one failure among 4 → `failure`; 2 success + 2 queued → `running`); `collapses finished columns` (8 columns, first 5 success, `maxColumns 4` → first node kind `done` with label `"<n> jobs done"`, last kind `later`, total columns ≤ 4); `edges between nodes deduplicated` (4 grouped builds all needing `lint` → exactly one edge `lint → g-Build`); `missing need and cycle fall back to depth 0` (needs `["ghost"]`; and a↔b cycle) completes and places jobs.
- [ ] **Step 2: Run** `bun test test/core/graph.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `jobDepths` (memoised DFS with an on-path set) and `buildGraph`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "core: job graph model with grouping and collapsing"`

### Task 4: Demo source (simulation)

**Files:**
- Create: `src/server/source.ts`, `src/server/demo-source.ts`, `src/server/demo-data.ts`
- Test: `test/server/demo-source.test.ts`

**Interfaces:**
- Consumes: `EntryInput`, `RunRecord`, `JobRecord` (Task 1).
- Produces:
  ```ts
  // source.ts
  export interface RunDetails { entryKey: string; runUrl: string; logExcerpt: string[]; jobs: JobRecord[] }
  export interface Source { start(onChange: (inputs: EntryInput[]) => void): void; stop(): void; details(entryKey: string): Promise<RunDetails | null> }
  // demo-source.ts
  export interface DemoOptions { count: number; running: number; seed?: number; now?: () => number; tickMs?: number; speed?: number }
  export class DemoSource implements Source { constructor(opts: DemoOptions); tick(): void; setRunning(n: number): void; breakOne(): void }
  ```
`demo-data.ts` holds the example pipelines from the mockup (small, medium, the Android pipeline with `mirror`, lint, 4 `Build · <target>` jobs in group `Build`, `Sign images`, 4 `Flash & boot · <device>` in group `Flash & boot`, `Publish OTA`), runner assignments (GH labels, `k8s` with `arc-aosp-64core`, `lab` benches), repository and workflow names, and the build-style failure logs. No test-result wording ("unit tests", "shard"). Each `tick()` advances running jobs (respecting `needs`), finishes runs (about 12% fail, a failing entry recovers about 85% of the time), keeps `running` runs in flight, and calls `onChange` with all `EntryInput`s (newest run first, with history). `speed` multiplies simulated time (default 60) so a 6-hour build passes in minutes while `startedAt`/`completedAt` stay consistent with that compressed clock.
- [ ] **Step 1: Write the failing tests** with a fixed `seed` and fake `now`: `seeds count entries` (`count 14` → 14 inputs); `keeps running target` (`running 5`, after 50 ticks always 5 runs not completed, give or take runs finishing that tick); `runs respect needs` (no job is `running` while one of its needs is not `success`); `android pipeline groups` (an Android entry has 4 jobs with `group "Build"`); `breakOne makes a failure` (after `breakOne()` one more input derives to `failed`); `no test wording` (no job or log line matches `/unit test|shard/i`).
- [ ] **Step 2: Run** `bun test test/server/demo-source.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with a small seeded PRNG (mulberry32) so tests are deterministic.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "server: demo source simulating workflows"`

### Task 5: Server: hub, SSE, HTTP, `lykta demo`

**Files:**
- Create: `src/server/hub.ts`, `src/server/http.ts`, `src/commands/demo.ts`, `src/web/index.html` (placeholder page `<div id="root">Lykta</div>` until Task 6)
- Modify: `src/cli.ts` (register `demo`; default action prints the banner plus "Run `lykta demo` to see the dashboard."), `test/cli.test.ts` (default-action expectation)
- Test: `test/server/http.test.ts`

**Interfaces:**
- Consumes: `Source`, `DemoSource` (Task 4); `deriveEntry` (Task 1); `expectedDuration` (Task 2).
- Produces:
  - `class Hub { constructor(version: string); update(inputs: EntryInput[]): void; snapshot(): DashboardState; subscribe(fn: (s: DashboardState) => void): () => void; ready: boolean }`. `update` derives entries (adds `expectedMs`) and notifies subscribers; `ready` becomes true on the first update.
  - `startServer(opts: { port: number; hostname?: string; hub: Hub; source: Source }): Server` (Bun.serve). Routes: `/` the web app via an HTML import of `src/web/index.html`; `GET /events` SSE (`event: snapshot` on connect and on every hub change, `event: ping` every 15 s, each `data` JSON `DashboardState`); `GET /api/entries/:key/details` → `RunDetails` JSON or 404; `GET /healthz` → 200 `ok`; `GET /readyz` → 200 when `hub.ready`, else 503.
  - `version` = `meta.VERSION` plus a build id (`process.env.LYKTA_BUILD_ID ?? String(startTime)`).
  - CLI: `lykta demo [--port <n>] [--host <h>] [--count <n>] [--running <n>] [--low-power]` (defaults `8080`, `0.0.0.0`, `14`, `2`); prints the URL; runs until Ctrl+C.
- [ ] **Step 1: Write the failing tests** in `test/server/http.test.ts` (start on port 0 with a `DemoSource`, seed fixed): `healthz ok`; `readyz 503 before first update, 200 after`; `events sends snapshot on connect` (read the stream until one `event: snapshot`, parse, `entries.length === 14`); `details 404 for unknown key`; `root serves html` (`content-type` includes `text/html`). Update `test/cli.test.ts`: default action output contains `lykta demo`.
- [ ] **Step 2: Run** `bun test test/server test/cli.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `Hub`, `startServer`, `commands/demo.ts`, register in `buildProgram()`.
- [ ] **Step 4: Run** `bun test`. Expected: PASS. Manual: `bun start demo` and open `http://localhost:8080` shows the placeholder.
- [ ] **Step 5: Commit** `git commit -m "server: SSE hub, HTTP routes and lykta demo"`

### Task 6: Web app shell, styles, fonts, stream client

**Files:**
- Modify: `package.json` (add `react`, `react-dom`, `motion`, `uqr`, `@fontsource-variable/inter`, `@fontsource/jetbrains-mono`; dev: `@types/react`, `@types/react-dom`, `happy-dom`), `tsconfig.json` (`lib: ["ESNext","DOM","DOM.Iterable"]`, `jsx: "react-jsx"`), `src/web/index.html`
- Create: `src/web/main.tsx`, `src/web/App.tsx`, `src/web/styles.css`, `src/web/stream.ts`, `src/web/canvas.ts`
- Test: `test/web/stream.test.ts`, `test/web/canvas.test.ts`

**Interfaces:**
- Consumes: `DashboardState` (Task 1); `/events` (Task 5).
- Produces:
  - `stream.ts`: `type StreamState = { data: DashboardState | null; connected: boolean; lastMessageAt: number; firstVersion: string | null; reload: boolean }`; `reduceStream(s: StreamState, ev: { type: "snapshot"; data: DashboardState; at: number } | { type: "ping"; at: number } | { type: "disconnected" } ): StreamState` (snapshot replaces `data`; `reload` true when `data.version !== firstVersion`); `isStale(s: StreamState, now: number, thresholdMs = 180_000): boolean`; `useDashboard(): StreamState` hook (EventSource with reconnect backoff 1 s doubling to 30 s; calls `location.reload()` when `reload`; schedules a reload at the next 04:00 local).
  - `canvas.ts`: `virtualSize(innerWidth: number, innerHeight: number): { width: 1920; height: number; scale: number }`; `useVirtualCanvas()` hook (ResizeObserver).
  - `App.tsx`: renders the scaled canvas, the header (Lykta mark, counts failing / running / passing / monitored, clock), a stale banner "Data is N min old" when `isStale`, and the three bands (placeholders until Tasks 8-10).
- [ ] **Step 1: Write the failing tests**: `reconnect replaces state` (two snapshots; second replaces entries entirely); `version change requests reload`; `stale after 3 minutes` (`isStale` false at 179 s, true at 181 s); `virtual canvas` (`virtualSize(3840, 2160)` → `height 1080, scale 2`; `virtualSize(2000, 1255)` → `height 1205`).
- [ ] **Step 2: Run** `bun test test/web`. Expected: FAIL.
- [ ] **Step 3: Implement**; `styles.css` defines the palette as CSS variables (Global Constraints) and imports the two font packages.
- [ ] **Step 4: Run** `bun run check`. Expected: PASS. Manual: `bun start demo` shows header and counts updating.
- [ ] **Step 5: Commit** `git commit -m "web: app shell, stream client, virtual canvas"`

### Task 7: Layout function

**Files:**
- Create: `src/web/layout.ts`
- Test: `test/web/layout.test.ts`

**Interfaces:**
- Consumes: `DashboardState` (Task 1).
- Produces:
  ```ts
  export interface LayoutPlan {
    empty: boolean;
    failures: { height: number; mode: "card" | "small" | "row"; columns: number; rows: number } | null;
    running: { height: number; mode: "single" | "split"; listWidth: 600; rowHeight: number; graphColumns: number } | null;
    monitored: { height: number; unit: "big" | "mid" | "chip" | "cell" | "tiny"; columns: number; rows: number; pages: number };
  }
  export function computeLayout(state: DashboardState, canvas: { width: number; height: number }, runningCount: number): LayoutPlan;
  ```
Values (spec 3.2 and the mockup): header 80, side padding 40, bottom padding 30, section label 28, band gap 18. Failures: ≤3 → `card` (height 320, or 230 when more than 4 are running); 4-6 → `small` if each card gets ≥190 px, else `row`; more → `row` in 3 columns (2 when width < 1500), height `min(400, ceil(n/3) * 74)` (cap 300 when more than 4 are running). Running: none → `null`; 1 → `single`; ≥2 → `split`, row height `clamp(floor((h - (n-1)*10)/n), 44, 120)`; running gets `0.62` of the remaining height for ≤2 runs and `0.84` for more. Graph columns `max(3, floor((cardWidth - 44 + 26) / 226))`. Monitored: the first unit in `big 430×200, mid 340×120, chip 300×76, cell 230×44, tiny 180×36` (column gap 14, row gap 10) that fits all entries in the given height, else `tiny` with `pages = ceil(n / perPage)`.
- [ ] **Step 1: Write the failing tests**: `calm screen uses big tiles` (10 passed, 0 running, 1920×1080 → `running null`, `unit "big"`); `busy screen shrinks monitored` (12 running, 40 entries → `running.mode "split"`, `monitored.unit` is `cell` or `tiny`); `many failures become rows` (9 failed → `mode "row"`, `columns 3`); `failures never dropped` (30 failed: `rows * columns >= 30`); `paging` (100 passed with 12 running → `pages > 1`); `empty state layout` (0 entries → `empty true`).
- [ ] **Step 2: Run** `bun test test/web/layout.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `computeLayout`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "web: layout function for band sizes and densities"`

### Task 8: Failure band

**Files:**
- Create: `src/web/components/FailureBand.tsx`, `src/web/components/RunnerBadge.tsx`
- Test: `test/web/failure-band.test.tsx`

**Interfaces:**
- Consumes: `EntryView`, `FailureInfo`, `RunnerInfo` (Task 1); `LayoutPlan.failures` (Task 7); `formatDuration` (Task 2).
- Produces: `<FailureBand entries={EntryView[]} plan={LayoutPlan["failures"]} now={number} onOpen={(key: string) => void} />`; `<RunnerBadge runner={RunnerInfo} short?={boolean} />` (badge text `GH`, `K8S`, `LAB`, `SELF`; GH shows the label, others the detail or label).
Cards per spec 3.2: "FAILED" tag, name · repo, "Broken for 3h 12m", failing job › step, runner badge, last log lines (mono, error lines in `#ff8a94`), branch, commit, actor. `missing` entries show "NOT FOUND" and the problem text. `small` drops the log, `row` is the dense red row. Every element carries `layoutId={entry.key}` (Motion) for morphs. A failure whose `brokenSince` is less than 10 s old gets the `fresh` arrival animation (scale 1.04 → 1, ring opacity 0.9 → 0, 1.4 s).
- [ ] **Step 1: Write the failing tests** (render with `react-dom/server` `renderToString`): `card shows broken for and failing step`; `missing shows not found`; `row mode renders rows` ; `long names are truncated with ellipsis class` (name of 200 characters is inside an element with class `ellipsis`).
- [ ] **Step 2: Run** `bun test test/web/failure-band.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** with styles copied from the mockup's `.fail`, `.failrow` rules.
- [ ] **Step 4: Run** `bun run check`. Expected: PASS. Manual: `bun start demo` and click "break" (Task 11 adds the control; meanwhile `--running 0` and wait) shows the cards.
- [ ] **Step 5: Commit** `git commit -m "web: failure band"`

### Task 9: Running area: list, rotating detail, job graph, lanes

**Files:**
- Create: `src/web/components/RunningArea.tsx`, `src/web/components/JobGraph.tsx`, `src/web/components/JobLanes.tsx`, `src/web/rotation.ts`
- Test: `test/web/rotation.test.ts`, `test/web/running-area.test.tsx`

**Interfaces:**
- Consumes: `buildGraph` (Task 3); `runProgress`, `formatDuration`, `formatClock` (Task 2); `LayoutPlan.running` (Task 7); `RunnerBadge` (Task 8).
- Produces:
  - `rotation.ts`: `dwellSeconds(n: number): number` = `clamp(30 / n, 6, 12)`; `nextSelection(state: { selectedKey: string | null; selectedAt: number }, runningKeys: string[], now: number, jumpTo?: string): { selectedKey: string | null; selectedAt: number }` (advances after the dwell, wraps, keeps selection if the key still runs, jumps immediately to `jumpTo`).
  - `<RunningArea entries={EntryView[]} plan={...} now={number} pinnedKey?={string} />`: `single` shows one full card; `split` shows the 600 px list (rows per spec 3.2, selected row highlighted with the amber connector) and the detail card with the dwell bar. Jump when a running job of a non-selected run turns `failure`.
  - `<JobGraph run={RunRecord} columns={number} />`: renders `buildGraph`, nodes as in the mockup, SVG cubic edges (amber dashed and flowing into running nodes, disabled in low power), group nodes with dots.
  - `<JobLanes run={RunRecord} max={number} />`: a lane per running (and just failed) job: name, runner badge, one segment per step, `step i/N · <step name>`. A step past `isStepSlow` (Task 2, usual duration from `expectedJobDurations` divided over steps is not available in demo, so the demo supplies per-step usual durations) shows its time in the slow colour `#ff9f6a`.
  - The detail card header: `RUNNING`, `done/total jobs`, `SLOWER THAN USUAL` when `runProgress().slow`, `2h 14m of ~5h 50m`, progress bar, `done ~17:40`.
- [ ] **Step 1: Write the failing tests**: `dwell is 6 to 12 seconds` (`n 2 → 12`, `n 5 → 6`, `n 3 → 10`); `rotation wraps`; `rotation jumps to failing run`; `rotation keeps selection while still running`; `split shows every running workflow` (5 running → 5 rows rendered); `slow marker shown` (run elapsed 1.3 × expected → text `SLOWER THAN USUAL`).
- [ ] **Step 2: Run** `bun test test/web`. Expected: FAIL.
- [ ] **Step 3: Implement**; graph edges measured after layout with `getBoundingClientRect` divided by the canvas scale.
- [ ] **Step 4: Run** `bun run check`. Expected: PASS. Manual: `bun start demo --running 5` shows the list and rotation.
- [ ] **Step 5: Commit** `git commit -m "web: running list, rotating detail, job graph and lanes"`

### Task 10: Monitored band

**Files:**
- Create: `src/web/components/MonitoredBand.tsx`
- Test: `test/web/monitored-band.test.tsx`

**Interfaces:**
- Consumes: `LayoutPlan.monitored` (Task 7); `EntryView` (Task 1); `formatDuration` (Task 2).
- Produces: `<MonitoredBand entries={EntryView[]} plan={...} page={number} onOpen={(key: string) => void} />`. Units per spec 3.2: `big` (PASSED / NEVER RUN tag, when, name, repo, branch · commit · actor · took, 14-mark history strip), `mid` (name · repo, when, history strip), `chip`, `cell`, `tiny`. Page dots when `pages > 1`; the App advances `page` every 12 s. Empty state message "Nothing is monitored yet" when there are no entries at all.
- [ ] **Step 1: Write the failing tests**: `big tile shows history strip` (14 marks, failures with class `f`); `never run tile` (text `NEVER RUN`); `page dots` (`pages 3` → 3 dots, one `on`); `renders empty message`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `bun run check`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "web: monitored band with detail tiles and paging"`

### Task 11: Motion, burn-in drift, low-power mode, demo controls

**Files:**
- Create: `src/web/power.ts`, `src/web/components/DemoControls.tsx`
- Modify: `src/web/App.tsx`, `src/server/http.ts` (demo-only `POST /api/demo/running/:n` and `POST /api/demo/break`, registered only for a `DemoSource`)
- Test: `test/web/power.test.ts`, extend `test/server/http.test.ts`

**Interfaces:**
- Consumes: Motion (`LayoutGroup`, `layoutId`, `AnimatePresence`); `DemoSource.setRunning`, `breakOne` (Task 4).
- Produces:
  - `power.ts`: `shouldUseLowPower(frameTimesMs: number[], forced: "auto" | "on" | "off"): boolean` (auto: median over the last 120 frames > 20 ms); `usePowerMode(forced)` hook sampling `requestAnimationFrame` for 10 s after load and then every 10 minutes; sets `data-power="low"` on the root.
  - App wraps bands in one `LayoutGroup` so an entry's `layoutId` morphs between monitored tile, running row/card and failure card (spring, ~0.6 s). Canvas drift: a 240 s alternating translate of ±6 px (CSS animation, off in low power). Flowing edges and glow opacity animations off when `data-power="low"`.
  - `DemoControls`: in demo mode only, a bottom bar that fades out after 3.5 s without mouse movement, with Running `0 / 2 / 5 / 12` and "Break one".
  - `lykta demo --low-power` forces `on`.
- [ ] **Step 1: Write the failing tests**: `low power when frames are slow` (120 × 33 ms → true; 120 × 16 ms → false; forced `on` → true; forced `off` with slow frames → false); http: `demo controls change running target` (POST `/api/demo/running/5`, next snapshot has 5 running entries).
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `bun run check`. Expected: PASS. Manual: in `bun start demo`, starting runs morphs tiles into rows; with `--low-power` drift and edge flow are off.
- [ ] **Step 5: Commit** `git commit -m "web: morph transitions, burn-in drift, low-power mode, demo controls"`

### Task 12: Detail overlay, QR code, keyboard, auto-close

**Files:**
- Create: `src/web/components/DetailOverlay.tsx`, `src/web/idle.ts`, `src/web/focus.ts`
- Modify: `src/web/App.tsx`
- Test: `test/web/idle.test.ts`, `test/web/focus.test.ts`, `test/web/detail-overlay.test.tsx`

**Interfaces:**
- Consumes: `GET /api/entries/:key/details` (Task 5, `RunDetails`); `uqr` (`renderSVG(url)`); entries from the stream.
- Produces:
  - `idle.ts`: `idleRemaining(lastInputAt: number, now: number, timeoutMs = 60_000): number` and `useAutoClose(open: boolean, onClose: () => void)` showing a countdown for the last 10 s.
  - `focus.ts`: `moveFocus(keys: string[], current: string | null, dir: "up" | "down" | "left" | "right"): string | null` over the on-screen order (failures, running list, monitored).
  - `<DetailOverlay entry={EntryView} details={RunDetails | null} onClose={() => void} />`: failed (failing job and step, skipped jobs, scrollable log excerpt, branch, commit, author, broken-for), running (pins the run: App passes `pinnedKey` to `RunningArea`; shows finished jobs), passed (last run summary, job durations, last log lines, no "what went wrong"). Every variant shows a QR code (SVG from `uqr`) for `runUrl` with the caption "Open on your phone".
  - Click or Enter opens; Escape closes; arrow keys move focus (visible amber outline).
- [ ] **Step 1: Write the failing tests**: `auto close after 60 seconds` (`idleRemaining` 0 at 60 s); `focus moves in order and wraps`; `overlay shows QR svg for run url` (render contains `<svg`); `passed overlay has no failure wording` (no "failed" or "error" text for a passed entry).
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `bun run check`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "web: detail overlay with QR code, keyboard and auto-close"`

### Task 13: Compiled binary, docs, release

**Files:**
- Modify: `README.md` (Status, a "Try the demo" section with `bunx @mklab-se/lykta demo` and the binary), `CLAUDE.md` (Architecture: `src/core`, `src/server`, `src/web`; how the web app is bundled), `CHANGELOG.md` (`[Unreleased]` entry), `.github/workflows/ci.yml` (smoke test also runs `./dist/lykta demo --port 0` for 5 s and fetches `/readyz` = 200)
- Test: `test/server/compiled.test.ts` (skipped unless `LYKTA_COMPILED_TEST=1`)

**Interfaces:**
- Consumes: everything above.
- Produces: `bun run build` → `dist/lykta` that serves the dashboard with the web app and fonts embedded (no files needed next to the binary).
- [ ] **Step 1: Write the failing test** `compiled binary serves the dashboard`: builds `dist/lykta`, starts `dist/lykta demo --port <free>`, `GET /` contains `id="root"`, the referenced JS and font URLs return 200, `/readyz` 200.
- [ ] **Step 2: Run** `LYKTA_COMPILED_TEST=1 bun test test/server/compiled.test.ts`. Expected: FAIL until embedding works.
- [ ] **Step 3: Implement** whatever the compile needs (HTML import embedding in `bun build --compile`; fix asset paths), and the docs above.
- [ ] **Step 4: Run** `bun run check && LYKTA_COMPILED_TEST=1 bun test test/server/compiled.test.ts && bun outdated`. Expected: all pass, `bun outdated` empty; `grep -rn --exclude-dir=node_modules --exclude-dir=.git $'\xe2\x80\x94' .` prints nothing.
- [ ] **Step 5: Commit** `git commit -m "Ship the demo dashboard in the compiled binary"`. Release via the repo's `/release minor` skill (0.1.0), after Kristofer has seen it running.
