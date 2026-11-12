# Lykta Plan 2: Real GitHub data, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `lykta serve --config lykta.yaml` shows the real state of configured GitHub Actions workflows
(github.com, several organizations, GitHub App or fine-grained tokens), with `lykta check` and
`lykta init` to get the configuration right, verified live against workflows in this repository.

**Architecture:** A `GitHubSource` implements plan 1's `Source` interface. It polls GitHub's REST API
through a small client (auth per organization, ETags, rate-limit aware serial queue), maps responses
to the core model with pure functions (runs, jobs, runner kinds, job graph from the workflow file,
log excerpts), and feeds the existing `Hub`. Everything else (SSE, web app) is unchanged.

**Tech Stack:** Bun (latest), TypeScript strict, `Bun.YAML`, `node:crypto` (RS256 for App JWTs),
`fetch`, commander, `bun test`. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-12-lykta-dashboard-design.md` (sections 3.1, 3.4, 3.5, 4, 5,
6.1, 6.3, 7, 8). Plan 1 (`docs/superpowers/plans/2026-11-12-lykta-1-dashboard-demo.md`) is merged: read
`src/core/types.ts`, `src/server/source.ts`, `src/server/hub.ts`, `src/server/http.ts`,
`src/commands/demo.ts` before starting.

**Facts verified on real runs (2026-11-12, `gh api` against mklab-se):**
- Reusable workflow jobs are named `<caller job name> / <callee job name>` (`CI / Typecheck`).
- Matrix jobs with a `name:` template get it filled in (`Build ${{ matrix.target }}` → `Build aarch64-apple-darwin`); without one, GitHub's default is `<job id or name> (<values, comma separated>)` (`Build (x86_64-apple-darwin)`).
- Job id equals check-run id (`check_run_url` ends with the job id); use `check_run_url` anyway.
- GitHub-hosted jobs have `runner_group_name: "GitHub Actions"` and labels like `ubuntu-latest`.
- `GET …/actions/jobs/{id}/logs` returns text with ANSI colour codes, an ISO timestamp prefix per line, `##[group]Run …` per step and `##[error]…` lines. Annotations come from `GET …/check-runs/{id}/annotations` (`annotation_level`, `message`).

## Global Constraints

- No em-dashes (U+2014) anywhere. Bun and all dependencies at latest; `bun outdated` empty at the end.
- `bun run check` (typecheck, Biome, tests) green before every commit. No test touches the network; GitHub responses come from fixtures in `test/fixtures/github/` or fakes.
- REST only, `https://api.github.com`, header `X-GitHub-Api-Version: 2026-03-10`, `Accept: application/vnd.github+json`, a generic `User-Agent: lykta/<version>`.
- Credentials never reach the browser, logs, or error messages (redact tokens in any thrown error text).
- Secrets only from environment variables or `*_FILE` variants: `LYKTA_APP_ID`, `LYKTA_APP_PRIVATE_KEY` / `LYKTA_APP_PRIVATE_KEY_FILE`, `LYKTA_TOKEN_<ORG>` / `LYKTA_TOKEN_<ORG>_FILE` (`<ORG>` upper-cased, `-` and `.` become `_`).
- Entry key: `<repo>:<workflow>:<branch>` (e.g. `mklab-se/lykta:ci.yml:main`).
- Polling defaults: running runs every 15 s, idle entries every 60 s; slow down automatically when the remaining rate limit drops below 20%.
- State rules stay in `src/core/state.ts` (plan 1); the mapper only translates GitHub's vocabulary.

## Review Focus

1. A configured workflow file that was renamed or deleted, a repository without access, or an organization with no App installation: each entry shows "not found" with a readable reason, the rest keep working. Test in Task 6 (`missing workflow becomes a problem, others continue`).
2. GitHub returns 403/429 rate limiting mid-sync: no crash, no hot retry loop; `retry-after` honoured and a warning shown. Test in Task 5 (`rate limit waits and warns`).
3. A workflow file the parser cannot read (invalid YAML, `needs` naming a missing job, expressions in `runs-on`): the graph falls back to a flat list, never throws. Test in Task 3 (`unparseable workflow falls back to flat`).
4. A run re-run (attempt 2) while attempt 1 failed: the newest attempt's jobs are shown, not a mix. Test in Task 2 (`latest attempt only`).
5. A GitHub App private key in PKCS#1 (`BEGIN RSA PRIVATE KEY`, GitHub's download format) with `\n` escaped in an env var: signing still works. Test in Task 4 (`escaped PKCS1 key signs`).

---

### Task 1: Configuration

**Files:**
- Create: `src/server/config.ts`, `lykta.example.yaml`
- Test: `test/server/config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface MonitorConfig { repo: string; workflow: string; branch: string; name: string; ignoreEvents: string[] }
  export interface RunnerRule { match: { runnerName?: string; label?: string; group?: string }; kind: "gh" | "k8s" | "lab" | "self"; label?: string }
  export interface OrgConfig { auth: "app" | "token" }
  export interface LyktaConfig {
    title?: string;
    organizations: Record<string, OrgConfig>;
    monitor: MonitorConfig[];          // defaults applied
    runners: RunnerRule[];
    server: { port: number; host: string };            // default 8080, "0.0.0.0"
    display: { lowPower: "auto" | "on" | "off" };      // default "auto"
    polling: { activeSeconds: number; idleSeconds: number }; // default 15, 60
  }
  export interface Secrets { appId?: string; appPrivateKey?: string; tokens: Record<string, string> }
  export class ConfigError extends Error { problems: string[] }
  export function parseConfig(yamlText: string, env?: Record<string, string | undefined>): LyktaConfig; // throws ConfigError listing every problem
  export async function loadConfig(opts: { path?: string; env?: Record<string, string | undefined> }): Promise<LyktaConfig>; // LYKTA_CONFIG (inline YAML) wins over the file; LYKTA_CONFIG_FILE over --config
  export async function loadSecrets(config: LyktaConfig, env?: Record<string, string | undefined>): Promise<Secrets>;
  export const entryKey: (m: MonitorConfig) => string;
  ```
Rules: `defaults.branch` (default `main`) and `defaults.ignoreEvents` (default `[]`) fill missing entry fields; `name` defaults to the workflow file name without extension, plus ` · <branch>` when the branch is not the default. Every `monitor[].repo` is `owner/name` and its owner is listed in `organizations`. Duplicate entry keys are an error. Env overrides: `LYKTA_PORT`, `LYKTA_HOST`, `LYKTA_LOW_POWER`, `LYKTA_TITLE`. `loadSecrets` reads `_FILE` variants and turns literal `\n` in a private key into newlines; missing secrets for an org are a `ConfigError` naming the variable to set. `lykta.example.yaml` is the spec section 4 example, monitoring this repo's live workflows (Task 9).
- [ ] **Step 1: Write the failing tests**: `defaults fill entries` (branch `main`, name `ci`); `name shows a non-default branch` (`ci · release/2.4`); `every problem is reported` (YAML with an unknown org and a duplicate entry → one `ConfigError` with 2 problems); `inline LYKTA_CONFIG wins`; `env overrides port and title`; `token from LYKTA_TOKEN_ACME_CORP for org acme-corp`; `_FILE variant is read`; `missing token names the variable` (message contains `LYKTA_TOKEN_MKLAB_SE`); `example config parses` (reads `lykta.example.yaml`).
- [ ] **Step 2: Run** `bun test test/server/config.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `src/server/config.ts` and write `lykta.example.yaml`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "github: configuration file, env overrides and secrets"`

### Task 2: Fixtures and mapping GitHub runs and jobs

**Files:**
- Create: `scripts/capture-fixture.ts`, `test/fixtures/github/` (captured JSON + workflow files + logs), `src/server/github/map.ts`
- Test: `test/server/github-map.test.ts`

**Interfaces:**
- Consumes: `RunRecord`, `JobRecord`, `StepRecord`, `RunnerInfo` (plan 1 `src/core/types.ts`); `RunnerRule` (Task 1).
- Produces:
  ```ts
  export interface GhRun { id: number; html_url: string; head_branch: string; head_sha: string; event: string; status: string; conclusion: string | null; created_at: string; run_started_at: string | null; updated_at: string; run_attempt: number; path: string; actor?: { login: string }; triggering_actor?: { login: string }; referenced_workflows?: { path: string; sha: string; ref?: string }[] }
  export interface GhJob { id: number; run_id: number; run_attempt: number; name: string; status: string; conclusion: string | null; started_at: string | null; completed_at: string | null; labels: string[]; runner_name: string | null; runner_group_name: string | null; check_run_url: string; steps?: { number: number; name: string; status: string; conclusion: string | null; started_at: string | null; completed_at: string | null }[] }
  export function mapRun(run: GhRun, jobs: GhJob[], rules: RunnerRule[]): RunRecord;   // needs/group filled by Task 3
  export function mapJobStatus(status: string, conclusion: string | null): JobStatus;
  export function classifyRunner(job: GhJob, rules: RunnerRule[]): RunnerInfo | undefined;
  ```
`scripts/capture-fixture.ts <owner/repo> <runId> <fixtureName>` uses `gh api` (the developer's own `gh` login; never commits tokens) to save `run.json`, `jobs.json` (all pages, `filter=latest`), the workflow file at `head_sha` plus every `referenced_workflows` file, and for each failed job `logs.txt` and `annotations.json`, under `test/fixtures/github/<fixtureName>/`. Capture three fixtures now: `lykta-release` (run 43242960581: reusable `CI / …`, matrix with filled-in names, all success), `lykta-ci-failed` (run 43289347026: Lint failed with annotations), `ailloy-release` (latest completed ailloy release run: `Build (…)` matrix names). Status mapping: `queued|waiting|requested|pending → queued`, `in_progress → running`, completed with `success → success`, `failure|timed_out|startup_failure → failure`, `skipped → skipped`, `cancelled|neutral|stale|action_required → cancelled`. Run `status` maps to `queued` (queued/requested/pending), `waiting`, `in_progress`, `completed`. `classifyRunner`: the first matching rule (glob `*` in `runnerName`, exact `label` or `group`); else `runner_group_name === "GitHub Actions"` → `gh` with the first label; else `self` with the runner group as `label` and the runner name as `detail`.
- [ ] **Step 1: Capture the fixtures** with the script (it is a dev tool; no test of its own). Expected: the three directories exist and `jobs.json` of `lykta-release` lists `CI / Typecheck`.
- [ ] **Step 2: Write the failing tests**: `maps a completed run` (lykta-release: 12 jobs, run `conclusion "success"`, `url` is the run's `html_url`, branch `refs/tags/…` stays as GitHub reports); `maps job and step statuses` (table over the status mapping above); `hosted runners are GH` (`Build x86_64-pc-windows-msvc` → `{kind: "gh", label: "windows-latest"}`); `runner rules win` (rule `{runnerName: "lab-bench-2*"}` → `lab` with its label); `self-hosted without a rule` (group `arc-aosp`, runner `arc-aosp-xyz` → `{kind: "self", label: "arc-aosp", detail: "arc-aosp-xyz"}`); `latest attempt only` (jobs from attempts 1 and 2 → only attempt 2 kept).
- [ ] **Step 3: Run** `bun test test/server/github-map.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `src/server/github/map.ts`.
- [ ] **Step 5: Run** the tests. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "github: map runs, jobs and runners; real fixtures"`

### Task 3: Job graph from the workflow file

**Files:**
- Create: `src/server/github/workflow-file.ts`
- Test: `test/server/workflow-file.test.ts`

**Interfaces:**
- Consumes: `JobRecord` (plan 1); fixtures (Task 2).
- Produces:
  ```ts
  export interface JobDef { id: string; name?: string; needs: string[]; matrix: boolean; uses?: string }
  export interface WorkflowDef { jobs: JobDef[] }
  export function parseWorkflow(yamlText: string): WorkflowDef | null;               // null when unreadable
  export function attachGraph(jobs: JobRecord[], caller: WorkflowDef | null, called: Record<string, WorkflowDef | null>): JobRecord[];
  ```
`called` is keyed by the `uses` path as written in the caller (e.g. `./.github/workflows/ci.yml`). Matching an API job name to a definition, in order: exact display name (`name` or id); a `name` containing `${{ … }}` becomes a pattern where each expression matches `.+`; GitHub's default matrix form `<display> (<…>)`; a reusable call `<caller display> / <callee display>` (callee matched recursively with the same rules). Each matched job gets `needs` = the ids of all API jobs matched to the definitions it needs (a reusable caller's `needs` apply to every callee job; callee jobs keep their internal `needs`), and `group` = the definition's display text with expressions removed and trimmed (`Build`) for matrix jobs, or the caller's display (`CI`) for reusable callee jobs. Unmatched jobs keep `needs: []`. Must never throw.
- [ ] **Step 1: Write the failing tests**: `parses needs as string or list`; `reusable callee jobs need what the caller needs` (lykta-release: `Build aarch64-apple-darwin` needs `CI / Typecheck`, `CI / Lint`, `CI / Test`, `CI / Build` and `Check version`; `CI / Lint` has group `CI`); `filled-in matrix names group together` (lykta-release: 4 `Build …` jobs share group `Build`); `default matrix names group together` (ailloy-release: `Build (…)` jobs share one group); `graph builds from real runs` (`buildGraph` from plan 1 over lykta-release has `GitHub Release` in a later column than every `Build …`); `unparseable workflow falls back to flat` (`parseWorkflow("::: not yaml")` is null and `attachGraph(jobs, null, {})` returns jobs with empty needs; a `needs: [ghost]` does not throw).
- [ ] **Step 2: Run** `bun test test/server/workflow-file.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with `Bun.YAML.parse`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "github: job graph from the workflow file, matrix and reusable workflows"`

### Task 4: Log excerpts and GitHub App / token auth

**Files:**
- Create: `src/server/github/logs.ts`, `src/server/github/auth.ts`
- Test: `test/server/logs.test.ts`, `test/server/auth.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // logs.ts
  export function cleanLog(raw: string): string[];                     // strips ANSI codes and the ISO timestamp prefix
  export function failureExcerpt(lines: string[], failedStep: string, max = 12): string[]; // lines of that step's ##[group]Run section, ending at and around the first ##[error]; "##[error]" prefix removed
  // auth.ts
  export interface TokenProvider { token(org: string): Promise<string>; kind(org: string): "app" | "token" }
  export function appJwt(appId: string, privateKeyPem: string, now: number): string; // RS256, iat now-60s, exp now+9min
  export function createTokenProvider(opts: { config: LyktaConfig; secrets: Secrets; fetch?: typeof fetch; now?: () => number }): TokenProvider;
  ```
App flow per org: `GET /orgs/{org}/installation` with the JWT (fall back to `GET /users/{org}/installation` on 404), then `POST /app/installations/{id}/access_tokens`; cache the token until 5 minutes before `expires_at`. Token flow: the org's token from `Secrets.tokens`. Errors name the org and what is missing ("no GitHub App installation for acme-corp"), never a token value.
- [ ] **Step 1: Write the failing tests**: `cleans ANSI and timestamps` (lykta-ci-failed `logs.txt` first line has no `\x1b[` and no leading timestamp); `excerpt is the failed step around its error` (lykta-ci-failed, step `Run bun run lint`: ≤ 12 lines, contains `Provide an explicit type attribute`); `excerpt without an error ends the step` (synthetic log); `jwt has RS256 header and app claims` (generate an RSA key with `crypto.generateKeyPairSync("rsa", {modulusLength: 2048})`, verify the signature with `crypto.verify`, check `iss`, `iat`, `exp`); `escaped PKCS1 key signs` (PKCS#1 PEM with `\n` literals after `loadSecrets` signs and verifies); `installation token is cached and refreshed` (fake fetch: one token request for two calls, a new one after `expires_at - 5 min`); `missing installation is a clear error`.
- [ ] **Step 2: Run** `bun test test/server/logs.test.ts test/server/auth.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with `node:crypto` `createSign("RSA-SHA256")` (accepts PKCS#1 and PKCS#8 PEM).
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "github: log excerpts and App/token authentication"`

### Task 5: REST client: ETags, rate limits, serial queue

**Files:**
- Create: `src/server/github/client.ts`
- Test: `test/server/client.test.ts`

**Interfaces:**
- Consumes: `TokenProvider` (Task 4).
- Produces:
  ```ts
  export class GitHubError extends Error { status: number; acceptedPermissions?: string }
  export interface RateState { remaining: number; limit: number; resetAt: number }
  export class GitHubClient {
    constructor(opts: { tokens: TokenProvider; fetch?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>; userAgent: string });
    json<T>(org: string, path: string): Promise<{ data: T; notModified: boolean }>;  // cached body returned on 304
    text(org: string, path: string): Promise<string>;                                // follows the logs redirect
    rate(org: string): RateState | undefined;
    onWarning(fn: (message: string) => void): void;
  }
  ```
One queue per org (serial). `If-None-Match` with the last ETag per path; a 304 returns the cached body with `notModified: true`. Reads `x-ratelimit-remaining/limit/reset` on every response. On 403 with `x-ratelimit-remaining: 0`, or 429: wait `retry-after` seconds (or until reset, at least 60 s), emit a warning "GitHub rate limit for <org>: data delayed until HH:MM", retry once; then throw. Other 4xx/5xx throw `GitHubError` (with `X-Accepted-GitHub-Permissions` when present); 5xx is retried once after 2 s.
- [ ] **Step 1: Write the failing tests** with a fake `fetch`: `sends version and auth headers`; `uses ETags and returns cached body on 304`; `rate limit waits and warns` (first 429 with `retry-after: 30` → fake `sleep(30000)` called, warning emitted, second attempt succeeds); `serial per org` (two concurrent calls for one org never overlap; different orgs may); `errors carry status and permissions, never the token`.
- [ ] **Step 2: Run** `bun test test/server/client.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "github: REST client with ETags, rate limits and a queue per org"`

### Task 6: GitHubSource (polling)

**Files:**
- Create: `src/server/github/source.ts`
- Modify: `src/server/hub.ts` (add `setWarnings(w: string[]): void` that broadcasts; snapshot gains `synced: boolean`, true after the first full sync)
- Test: `test/server/github-source.test.ts`

**Interfaces:**
- Consumes: `LyktaConfig` (Task 1), `mapRun` (Task 2), `parseWorkflow`/`attachGraph` (Task 3), `cleanLog`/`failureExcerpt` (Task 4), `GitHubClient` (Task 5), `Source`, `RunDetails` (plan 1).
- Produces: `class GitHubSource implements Source { constructor(opts: { config: LyktaConfig; client: GitHubClient; now?: () => number; schedule?: (fn: () => void, ms: number) => unknown }); syncAll(): Promise<void>; details(entryKey, runId?) }` and `onWarnings(fn)`.
Per entry: `GET /repos/{repo}/actions/workflows/{workflow}/runs?branch=<branch>&per_page=15&exclude_pull_requests=true` (drop runs whose `event` is in `ignoreEvents`); for each run that is not completed, and once for each newly completed one, `GET …/runs/{id}/jobs?filter=latest&per_page=100` (all pages). History for expected durations: jobs of up to 5 latest successful runs, fetched once and cached by run id (completed runs never change). Workflow files: `GET /repos/{repo}/contents/{run.path}?ref={head_sha}` (decode base64), plus each `referenced_workflows` file, cached by `(repo, sha, path)`; run through `attachGraph`. For a newly failed run: the first failed job's log via `client.text` → `failureExcerpt`, stored as the entry's `FailureInfo` (with its runner). Not found: a 404 on the runs list → `GET …/actions/workflows/{workflow}`; problem text "Workflow <file> not found in <repo> (renamed, deleted, or no access)", or "Workflow <file> is disabled (<state>)", or for 403 "No access to <repo>: needs <permissions>". Cadence: running entries every `activeSeconds`, others every `idleSeconds`, both doubled while any org's remaining rate is below 20%. `details()` returns the run's jobs (from cache), its URL and the failure excerpt for failed runs or the last 12 cleaned log lines of the last job otherwise.
- [ ] **Step 1: Write the failing tests** with a fake client serving the fixtures: `first sync yields every entry` (3 entries → 3 inputs, `synced` true); `running run polls jobs, completed run is fetched once` (count requests over two syncs); `failed run gets a log excerpt and runner`; `history gives expected durations` (5 successful fixture runs → `Hub` sees `expectedMs`); `ignored events are dropped`; `missing workflow becomes a problem, others continue` (one entry 404 + workflow 404 → `problem` set; others normal); `no access names the permission` (403 with `X-Accepted-GitHub-Permissions: actions=read`); `slows down on low rate` (remaining 10% → next idle poll scheduled at 120 s).
- [ ] **Step 2: Run** `bun test test/server/github-source.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**; show `client` warnings through `Hub.setWarnings` (the header shows warnings as the amber banner from plan 1, next to "Data is N min old").
- [ ] **Step 4: Run** `bun run check`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "github: polling source with history, graphs, failures and problems"`

### Task 7: `lykta serve` and the "connecting" screen

**Files:**
- Create: `src/commands/serve.ts`
- Modify: `src/cli.ts` (register `serve`; default action now says `lykta serve --config lykta.yaml` or `lykta demo`), `src/web/App.tsx` + `src/web/components/Header.tsx` (warnings banner; "Connecting to GitHub..." screen while `synced` is false instead of "Nothing is monitored yet")
- Test: `test/server/serve.test.ts`, `test/web/connecting.test.tsx`

**Interfaces:**
- Consumes: Tasks 1 to 6; `startServer`, `Hub` (plan 1).
- Produces: `lykta serve [--config <path>] [--port <n>] [--host <h>]`: loads config and secrets (prints every `ConfigError` problem and exits 2), starts the source and the server, `/readyz` 200 only after the first full sync, logs one line per sync with counts and rate remaining (no secrets).
- [ ] **Step 1: Write the failing tests**: `serve fails clearly on a bad config` (spawn `bun src/cli.ts serve --config <tmp bad yaml>` → exit 2, stderr lists the problems); `readyz waits for the first sync` (in-process: `GitHubSource` with a fake client that resolves after a delay); `connecting screen before first sync` (render `App`-level band with `synced: false` → "Connecting to GitHub"); `warnings are shown` (header renders a warning string).
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `bun run check`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "lykta serve: real GitHub data on the dashboard"`

### Task 8: `lykta check` and `lykta init`

**Files:**
- Create: `src/commands/check.ts`, `src/commands/init.ts`
- Modify: `src/cli.ts`
- Test: `test/commands/check.test.ts`, `test/commands/init.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 4, 5, 6.
- Produces:
  - `lykta check [--config <path>]`: validates the config, authenticates each org (App installation found, or token works, with the org's remaining rate), and for each entry prints `✓ <name> (<repo> <workflow> <branch>): last run <conclusion> <ago>` or `✗ <name>: <problem>`. Exit 0 when all pass, 1 when any entry fails, 2 on config errors. `runCheck(config, secrets, client): Promise<{ ok: boolean; lines: string[] }>` is the testable core.
  - `lykta init [--output lykta.yaml]`: asks for organizations and their auth (`app` / `token`), then repositories and workflow files (when a token for the org is already in the environment, it lists the repository's workflows via `GET /repos/{repo}/actions/workflows` to pick from), and writes the YAML; never writes secrets, and prints which environment variables to set. `buildConfigYaml(answers): string` is the testable core; prompts use `node:readline/promises`.
- [ ] **Step 1: Write the failing tests**: `check reports each entry` (fake client: one good, one missing → `ok false`, a ✓ and a ✗ line); `check reports a missing installation per org`; `init writes a config that parses` (`buildConfigYaml` output → `parseConfig` succeeds; contains no token); `init lists the env vars to set`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `bun run check`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "lykta check and lykta init"`

### Task 9: Live test workflows in this repository

**Files:**
- Create: `.github/workflows/live-pipeline.yml`, `.github/workflows/live-reusable.yml`, `.github/workflows/live-quick.yml`
- Modify: `lykta.example.yaml` (monitors the three), `README.md` (a short "Try it against GitHub" section), `test/server/workflow-file.test.ts`
- Test: extend `test/server/workflow-file.test.ts` with `live workflows parse into the expected graph`

**Interfaces:**
- `live-pipeline.yml`: `workflow_dispatch` with inputs `fail_at` (choice: `none`, `prepare`, `build`, `test`, `deploy`; default `none`) and `minutes` (number, default `3`, the long job's length); jobs: `prepare` → matrix `build` (`name: Build ${{ matrix.target }}`, 4 targets) → `checks` calling `live-reusable.yml` (`uses: ./.github/workflows/live-reusable.yml`) → `long` (sleeps `minutes` in steps of 60 s, one step per minute so lanes move) → `deploy` (needs `checks` and `long`). Each job is echo/sleep only on `ubuntu-latest`, and fails with `exit 1` when `fail_at` names it.
- `live-reusable.yml`: `workflow_call` with jobs `lint`, `typecheck` (parallel) and `report` (needs both).
- `live-quick.yml`: `workflow_dispatch` only, one job of two steps (a fast green tile).
- No `schedule` triggers (no Actions minutes spent unless someone presses "Run workflow").
- [ ] **Step 1: Write the failing test**: `live workflows parse into the expected graph` (`parseWorkflow` on the three files; `checks` uses the reusable file; `deploy` needs `checks` and `long`; 4 build targets).
- [ ] **Step 2: Run** `bun test test/server/workflow-file.test.ts`. Expected: FAIL (files missing).
- [ ] **Step 3: Write** the workflows and update the example config and README.
- [ ] **Step 4: Run** `bun run check`. Expected: PASS. CI's em-dash check covers the YAML.
- [ ] **Step 5: Commit** `git commit -m "Live test workflows for Lykta"`

### Task 10: Live verification, docs, CHANGELOG

**Files:**
- Modify: `CLAUDE.md` (architecture: `src/server/config.ts`, `src/server/github/*`, commands), `CHANGELOG.md` (`[Unreleased]`), `README.md` (configuration quick reference, link to `lykta.example.yaml`)
- Test: none new (manual verification below, recorded in the ledger)

**Interfaces:**
- Consumes: everything above.
- [ ] **Step 1: Push** the branch's live workflows to `main` only after review (they must exist on the default branch to be dispatchable): ask Kristofer before pushing.
- [ ] **Step 2: Dispatch** `live-pipeline.yml` with `fail_at: none`, then with `fail_at: build` and `minutes: 4` (`gh workflow run live-pipeline.yml -f fail_at=build -f minutes=4`), and `live-quick.yml` (Kristofer's OK covers these runs).
- [ ] **Step 3: Run** `LYKTA_TOKEN_MKLAB_SE=$(gh auth token) bun src/cli.ts serve --config lykta.example.yaml` and watch in the browser: the pipeline's graph (matrix grouped as `Build ×4`, reusable `checks` jobs grouped), the long job's step lanes, the failure card with the excerpt of the failing step, the green quick tile, and `lykta check` output. Expected: all appear as the spec describes; note anything that does not.
- [ ] **Step 4: Update** CLAUDE.md, CHANGELOG, README; `bun outdated` empty; no em-dashes.
- [ ] **Step 5: Commit** `git commit -m "Docs for lykta serve, check and init"`
