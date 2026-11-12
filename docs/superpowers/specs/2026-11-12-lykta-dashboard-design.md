# Lykta dashboard: design

Status: for Kristofer's approval. Date: 2026-11-12.
Visual reference: [`assets/command-center-mockup.html`](assets/command-center-mockup.html) (open in a
browser; the bottom bar switches the number of monitored and running workflows).

## 1. Intent

Lykta replaces a Jenkins build monitor on wall-mounted monitors and TVs with a modern dashboard for
**GitHub Actions**. Today's monitor is one big red or green square per job: it works for "something
is red", but nobody looks closer, and it wastes the screen.

Lykta has two jobs, in this order:

1. **Make failures impossible to ignore.** Anyone walking past should see at once that something is
   broken, what broke, and for how long, and feel an urge to fix it.
2. **Show what is happening** in the monitored workflows, and make it obvious which workflows are
   monitored, so people can confirm the right ones are watched.

It should look and move like a top-notch product, not a status page: dark, calm in normal operation,
with animation that lets a viewer follow what changed.

### Who uses it

- People walking past or glancing from their desks: they must get the state from across a room.
- Occasionally someone walks up with a mouse or keyboard to understand a failure.
- Whoever operates it: edits a config file, deploys it on a laptop or in Kubernetes, and then never
  touches the screens again.

### Kristofer's environment (facts that shape the design)

- Repositories only on **github.com**, across **several organizations**.
- Typically 10-20 monitored workflows per dashboard, sometimes 50-100.
- **Many workflows often run at the same time**, and sometimes none.
- Workflows are complex: many jobs and steps, matrices. **Android OS builds run up to 6 hours**, most
  of it inside one long compile step.
- Jobs run on GitHub-hosted runners, on **ARC runners in on-prem Kubernetes**, and on **physical lab
  machines with attached devices**.
- Test-level results (individual tests) are **not** available inside the workflows. Lykta works with
  workflows, jobs, steps and logs only.

## 2. Goals, non-goals, anti-goals

**Goals**

- A failure is visible on every screen size, always, with how long it has been broken, the failing
  job and step, where it ran, and the relevant log lines.
- Every running workflow is always visible; the details of each are shown in turn.
- Every monitored workflow is always visible, at lower importance.
- A configured workflow that cannot be found or read is shown as a problem (a silent gap in
  monitoring is worse than a visible error).
- Runs on its own for weeks: recovers from network drops, backend restarts, API errors and new
  deployments without anyone touching the screen.
- Readable from across a room on 1080p monitors up to 4K TVs, at any aspect ratio.

**Non-goals (first version)**

- No admin UI. Configuration is a file plus environment variables.
- No Kubernetes cluster access (GitHub's runner information only). Tracked in [issue #2](https://github.com/mklab-se/lykta/issues/2).
- No AI explanation of failures. Tracked in [issue #1](https://github.com/mklab-se/lykta/issues/1); the design leaves room for it.
- No GitHub Enterprise Server.
- No branch patterns. Each monitored entry names one branch.
- No per-test results.
- No viewer authentication: the dashboard is anonymous and meant for internal networks. Tracked in
  [issue #3](https://github.com/mklab-se/lykta/issues/3).

**Anti-goals (would make it a failure even if it technically works)**

- A wall that cries wolf: work-in-progress branches or manual experiments turning the screen red.
- A screen in constant motion, so real changes drown in noise.
- A dashboard that silently shows stale or partial data as if it were current and green.
- Monitoring that silently drops a workflow because it was renamed, moved or lost access.
- Burn-in or a browser that slowly eats memory over weeks.

## 3. What Lykta shows

### 3.1 Workflow states

Each monitored entry (one workflow on one branch) is always in exactly one state:

| State | Meaning | Shown as |
| --- | --- | --- |
| **Never run** | Monitored, no run on that branch yet | compact, dashed outline, "never run" |
| **Passed** | Latest completed run succeeded | compact, green |
| **Failed** | Latest completed run concluded `failure`, `timed_out` or `startup_failure` | failure band, red |
| **Running** | A run is in progress | running area, amber |
| **Not found** | Repository, workflow or branch missing, or no access | failure band, red outline |

Rules (my calls, see section 10):

- "Latest" is the most recent run for that workflow on that branch, by creation time. A re-run
  (new attempt) replaces the previous attempt's result.
- Cancelled runs are ignored when deciding passed or failed (the previous completed result stands);
  a cancelled run is not a failure. The same applies to `skipped`, `neutral`, `stale` and
  `action_required` (a run waiting for approval is shown as running/waiting, never red).
- The run's own conclusion decides; jobs with `continue-on-error` count the way GitHub counts them.
- If a workflow was failing and a new run is in progress, it is shown **both** in the failure band
  (still broken, since when) and in the running area (being fixed?). When that run passes, the
  failure clears with a visible transition.
- "Broken for" counts from the end of the first failed run in the current failing streak.

### 3.2 Layout: the track and the pit (replaces the Command Center below, 2026-11-12)

Kristofer's redesign: with many runs and failures the Command Center's bands made it hard to see
what is monitored and what fails, because a workflow could be in four places. Now every workflow
has one place, and failures go to the pit.

- **The track: a fixed grid of every monitored workflow**, in config order. Its shape (columns ×
  rows) is decided from the number of workflows and the full screen width, and never changes
  when the pit opens: the tiles get narrower, but top right stays top right. A tile shows the
  name, its latest status and the history strip (older results fade). Tiles grow and shrink in
  detail with their size.
- **Running**: the tile turns yellow with a steady glow and one slow breath shared by all running
  tiles (my call: not each pulsing on its own), and a thin progress bar against the expected
  duration with "2h 14m of ~5h 50m". A workflow re-running after a failure keeps a small red
  mark until the run decides (my call).
- **The spotlight**: about every 20 seconds (`display.spotlightEverySeconds`), one running
  workflow opens as a large diagram over the track for about 8 seconds
  (`display.spotlightSeconds`): the job graph and where the run is. The track behind it blurs
  (dims in low-power mode); the pit is never covered. Running workflows take turns. When a run
  finishes it gets one last turn (my call): a pass in green, a failure with the failed job and
  step in red and its error, and only then does a failure move to the pit. This replaces holds.
- **The pit**: a pane that slides in from the left (about 30% of the width) when the first
  workflow fails and disappears when the last one is fixed. A failed workflow moves there and
  leaves a gap in its slot (my call: a very faint dashed outline). Each car in the pit is a red
  card: name, broken for, the strip of how far it got, failed job › step and the error message.
  Cards get more compact as the pit fills. A not-found workflow is in the pit too. When a
  workflow in the pit is restarted, it drives back out to its slot (yellow); if it fails again,
  it returns.

### 3.2.1 Layout: Command Center (superseded by 3.2)

One full-screen page on a black background. Header: Lykta mark, counts (failing, running, passing,
monitored) and a clock. Below it, three bands whose sizes follow what is happening:

1. **Needs fixing** (top, fixed, never scrolls or rotates). Failed and not-found workflows.
   - Up to 3: large cards with: workflow and repository, "Broken for 3h 12m", failing job › step,
     where it ran, the last log lines around the error, and (later) an AI summary.
   - 4-6: smaller cards without the log.
   - More: dense red rows (name, failing job › step, broken-for), in 2-3 columns.
   - It always fits: density increases instead of anything leaving the screen.
2. **In progress** (only present while something runs).
   - 1 running: a full-width card.
   - 2 or more: a **list of every running workflow on the left**, and a **detail panel on the
     right**. A highlight walks down the list (wrapping around) and the detail panel shows the
     highlighted workflow for 6-12 seconds (longer when fewer run), with a thin bar showing time
     left. When something happens in a run that is not highlighted (a job fails, the run ends),
     the highlight jumps to it.
   - List rows: name and repository, progress bar against the expected duration, "elapsed of
     ~expected", and when room allows the expected finish time and the active job › step.
   - Detail panel: the **job graph** (section 3.3), a **lane per running job** (name, where it runs,
     one segment per step, "step 7/15 · m -j64"), progress against expected duration, expected
     finish time, branch, commit, who triggered it, and a **slower than usual** marker when the run
     or a step is well past its usual duration.
3. **All monitored** (bottom, always present). Passed and never-run workflows.
   - Takes all remaining space. With room to spare: large tiles (name, repository, result, when,
     branch, commit, who, how long it took, and a strip of the last ~14 results, so flaky
     workflows stand out). As space shrinks: medium tiles, chips, then small cells.
   - If they still do not fit, they page automatically (with page dots) every ~12 seconds.

Space moves between bands with animation: when runs start, the monitored tiles shrink to make room;
when everything is calm, they grow to fill the screen.

### 3.3 Job graph

- Jobs are laid out left to right by dependency depth (from the workflow's `needs`), parallel jobs
  stacked, with curved edges; edges into running jobs animate.
- Each job shows its status, name, where it runs, and, when running, the current step and progress.
- **Matrices and large groups** (more than 3 jobs from the same matrix or reusable workflow in a
  column) fold into one group node: "Build ×4", a dot per job, counts (done / running / failed), and
  where they run ("K8S · 3 runners").
- **Long pipelines** keep the active part in view: finished columns collapse into "✓ N jobs done" on
  the left, later columns into "+N jobs" on the right. The number of visible columns follows the
  available width.

### 3.4 Where a job runs

From what GitHub reports (no cluster access in v1):

- **GitHub-hosted**: the runner label, for example `ubuntu-latest`, badge "GH".
- **Self-hosted on ARC (Kubernetes)**: runner group / scale set and runner (pod) name, badge "K8S".
- **Lab machines**: badge "LAB" plus a human description from configuration, mapped from runner
  name or label, for example `lab-bench-2` → "Pixel 9 + Zebra ZT411".
- The mapping from labels/runner names to these kinds is configurable (section 6), with sensible
  defaults (GitHub-hosted labels are recognised; everything else is "self-hosted" unless mapped).

### 3.5 Long runs

- **Expected duration** per monitored entry and per job = the median of the last successful runs
  (up to 5), learned from GitHub at startup and updated as runs finish.
- Progress shown as "2h 14m of ~5h 50m", with "done ~17:40".
- **Slower than usual**: a run past 125% of its expected duration, or a step past 150% of its usual
  duration, gets an amber-red marker. No marker when there is no history yet.
- Long runs stay calm: no extra animation beyond the slow progress and the running-job spinner.

### 3.6 Motion

- Structural changes animate as shared-element transitions: a monitored tile **morphs** into its
  running row and detail card when a run starts, and back (or into the failure band) when it ends.
- A **new failure** arrives with one strong pulse and a short glow, then settles into a slow,
  low-contrast "breathing" background. A cleared failure leaves with a visible transition.
- Normal operation is calm: only progress bars, spinners on running jobs, and the slow highlight.
- **Burn-in**: the whole canvas drifts by a few pixels over minutes; no static pure-white elements;
  large areas stay dark.

### 3.6.1 Where it failed, and holding a finished run (added 2026-11-12)

Kristofer's request, from watching the wall: where a workflow failed must be visible, not only
its log, and a run people were watching must not vanish the moment it fails.

- **Across the room: how far it got.** Every failure card has a strip of blocks, one per job,
  stage by stage (a matrix folds into one block): passed jobs green, the failed one red and
  larger, jobs that never ran dim. Rows in a dense failure band show a small strip too.
- **Up close: the error message itself**, not a guess at the cause. Under "job › step", the
  first error lines of the failed step are the card's biggest text: lines GitHub flags as errors
  and compiler-style "error:" lines, never the script that printed them, never GitHub's generic
  "Process completed with exit code N". With no error line, the card says why the job ended
  (timed out, cancelled, startup failure). The log lines that led up to it follow when there is
  room. The first error rather than the last, because later ones are usually follow-ups and
  summaries (my call).
- **Holding a finished run.** A run that fails stays big in the running area, in the same place,
  for `display.holdFailedSeconds` (default 180): red, the whole job graph with the failed job and
  step marked, the error message, and when it shrinks ("shrinks in 2:41"). A pass stays green for
  `display.holdPassedSeconds` (default 45). Then it morphs into its failure card or passed tile.
  Each run keeps its own hold, so several failures stay side by side. When the same workflow
  starts again, the new run takes over its space at once. Held runs take running space, never a
  failure card's or a tile's.
- Clicking a failure card opens the detail overlay as before. In the demo, holds are scaled to
  its fast clock.

### 3.7 Interaction (occasional, mouse or keyboard)

- Click (or arrow keys + Enter) on a workflow opens a **detail overlay**:
  - **Failed**: failing job and step, jobs skipped because of it, a long scrollable log excerpt around
    the error, error annotations if GitHub has them, branch, commit, author, broken-for.
  - **Running**: pins it in the detail panel and pauses the rotation; finished jobs' logs if
    available.
  - **Passed**: summary of the last run (jobs, durations) and the last lines of its log, with no
    "what went wrong".
  - Every overlay shows a **QR code** for the run's page on GitHub, so a person can open the full run
    on their phone (the kiosk browser is usually not logged in to GitHub).
- After **60 seconds** without input, everything closes and the default view returns, with a small
  visible countdown.

## 4. Configuration

One YAML file plus environment variables. Secrets only in environment variables or files mounted
from Kubernetes Secrets. No admin UI.

```yaml
# lykta.yaml
title: Android Platform          # optional, shown in the header
defaults:
  branch: main
  ignoreEvents: [workflow_dispatch]   # optional: triggers that never count on the wall

organizations:
  mklab-se:
    auth: app            # GitHub App: LYKTA_APP_ID + LYKTA_APP_PRIVATE_KEY (or _FILE); installation looked up per org
  acme-corp:
    auth: token          # fine-grained PAT from LYKTA_TOKEN_ACME_CORP (or _FILE)

monitor:
  - repo: mklab-se/android-platform
    workflow: nightly.yml               # workflow file name (stable), not the display name
  - repo: mklab-se/android-platform
    workflow: nightly.yml
    branch: release/2.4
    name: Nightly · release/2.4         # optional display name
  - repo: acme-corp/billing
    workflow: ci.yml

runners:                                # optional: how to describe where jobs run
  - match: { runnerName: "lab-bench-2*" }
    kind: lab
    label: "lab-bench-2 · Pixel 9 + Zebra ZT411"
  - match: { label: "arc-aosp-64core" }
    kind: k8s
```

- **One entry = one tile.** Monitoring the same workflow on another branch is another entry.
- Every setting can be overridden by environment variables (`LYKTA_*`), so one image serves many
  instances.
- `lykta check --config lykta.yaml` validates the file, authenticates, and reports every entry that
  cannot be found or read, before anything is put on a wall.

## 5. Access to GitHub

- **github.com only.** Per organization, either:
  - **GitHub App** (recommended): created once, installed in each organization, read-only
    permissions (see section 7), short-lived installation tokens refreshed automatically, rate limit
    per installation.
  - **Fine-grained personal access token**: simplest for a laptop or a quick start; read-only on the
    repositories concerned.
- Credentials stay on the server. The browser only ever receives dashboard state.

## 6. Architecture

```
GitHub REST API  <--poll (ETags)--  Bun server  --SSE-->  browser(s) on the wall
                                      |
                                      +-- in-memory state, rebuilt from GitHub on start
```

### 6.1 Server (Bun, TypeScript)

- **Sources**: a `GitHubSource` (polling only in v1; webhooks are a possible later addition) and a `DemoSource` (simulation), behind
  one interface, so the rest of the system cannot tell them apart.
- **Poller** per organization:
  - For each monitored entry, list recent runs of that workflow on that branch, using conditional
    requests (ETag) so unchanged answers are cheap.
  - For running runs, fetch jobs frequently (active cadence); for idle entries, check for new runs
    less often (idle cadence). Cadences adapt to the remaining rate limit and the number of entries.
  - When a run completes or fails, fetch its jobs once more, the failing job's log excerpt, and
    annotations.
  - Fetch the workflow file at the run's commit to build the job graph; cache by (repo, sha, path).
  - Track the rate limit per organization and slow down before hitting it; show a discreet warning on
    the wall when data is delayed because of limits.
  - Leave a big buffer: other teams and other Lykta installations share the same organizations'
    limits. Lykta uses at most a configured share of the hourly limit (`polling.budget`, default
    20%), slows down as soon as under half of the limit is left, and on a rate-limit answer stops
    calling that organization until the reset instead of retrying.
- **Mapper** (pure functions, the core of the test suite): GitHub runs + jobs + workflow file →
  `DashboardState` (entry states, graphs with matrix/reusable-workflow grouping, runner kinds,
  expected durations, slow markers, broken-for).
- **State store**: in memory only. On start, everything is rebuilt from GitHub (latest runs, recent
  history for durations and the result strip). No database, no shared state between instances.
- **HTTP**:
  - `GET /` the dashboard app (static, bundled).
  - `GET /events` Server-Sent Events: a full snapshot on connect, then changes. Each message carries
    the server's build version.
  - `GET /api/runs/:id/details` on demand for overlays (log excerpt, annotations).
  - `GET /healthz` (process alive), `GET /readyz` (configuration valid and first full sync done).
- **CLI**: `lykta serve`, `lykta check`, `lykta demo` (built on the existing commander CLI).

### 6.2 Browser app

- **React 19 + Motion** (my call): Motion's shared-layout animations (`layoutId`) do exactly the
  morphs this design needs (a tile in one band becoming a row and a card in another), interruptible
  and smooth, and Bun bundles React natively without extra tooling. Alternatives considered: plain
  View Transitions API (good, used in the mockup, but less control over interruption and
  per-element timing), Svelte (fine, but React + Motion is the strongest pairing for layout
  animation).
- A pure **layout function** decides densities (card / small card / row, graph columns, tile size,
  pages) from the state and the screen size, so it can be tested without a browser.
- Rendering is resolution-independent: the layout uses a virtual 1920-wide canvas whose height
  follows the screen's aspect ratio, scaled to fit.
- **Low-powered screens** (mini PCs, TV sticks, Raspberry Pis driving TVs) are the target hardware:
  - Animate only `transform` and `opacity`; no animated blur, filters or box-shadows; glows are
    static gradients faded with opacity. Few simultaneous animations.
  - **Low-power mode** switches on automatically when measured frame times stay high (and can be
    forced in config): it drops the canvas drift, the flowing graph edges and the glows, and keeps
    the morphs and state changes.
  - No per-frame JavaScript work in steady state beyond the active animations; live values update
    at most once a second.
  - Fonts are bundled (no network fetches); the docs recommend 1080p output even on 4K TVs.
  - Acceptance: demo mode runs smoothly for 24 hours on a Raspberry Pi (Kristofer's test), with flat
    memory use.
- **Kiosk resilience**:
  - SSE reconnects with backoff; after reconnect the snapshot replaces all state.
  - If the server's build version changes, the page reloads itself (new deployments are picked up).
  - If data is older than a threshold (default 3 minutes), a visible "data is N min old" banner
    appears; the wall never pretends to be current.
  - A scheduled full reload once a day (default 04:00, configurable) as a safety net for memory.
  - Bounded state (no unbounded arrays in the browser), animations on transform/opacity only.

### 6.3 Running it

The same `lykta.yaml` (plus secrets in environment variables) works in every way of running Lykta.

- **Directly with Bun or the binary**: `bunx @mklab-se/lykta serve --config lykta.yaml`, or
  `brew install mklab-se/tap/lykta`.
- **Prebuilt container, no compiling**: a multi-arch image (linux/amd64, linux/arm64) built from the
  single-file binary into a small runtime image, running as non-root, published by the release
  workflow to `ghcr.io/mklab-se/lykta` (tags `X.Y.Z`, `X.Y`, `latest`). Configuration:
  - mount the file: `docker run -p 8080:8080 -v ./lykta.yaml:/config/lykta.yaml:ro --env-file lykta.env <image>`
  - or, for the smallest start, pass the whole YAML in `LYKTA_CONFIG` (no file needed).
  - secrets: `LYKTA_APP_ID` / `LYKTA_APP_PRIVATE_KEY` (or `_FILE` variants), `LYKTA_TOKEN_<ORG>`.
- **Kubernetes, with Argo CD (or any GitOps tool)**: a **Helm chart** in the repo (`charts/lykta`),
  also published as an OCI chart next to the image.
  - `values.yaml` holds the Lykta configuration as YAML (rendered into a ConfigMap), image, resources,
    Service/Ingress, and `existingSecret` (so Sealed Secrets / External Secrets work unchanged).
  - Probes: liveness `/healthz`, readiness `/readyz`. Pod restarts on config change (checksum
    annotation).
  - An Argo CD `Application` example points at the chart and carries the values inline.
  - A plain-manifest example (Deployment, Service, ConfigMap, Secret) for those not using Helm.
- **Several instances side by side**: each is its own process, container or Helm release / Argo CD
  Application with its own config; nothing is shared. On one machine: different ports.
- **Tooling**:
  - `lykta init`: asks a few questions (organizations, auth, workflows) and writes a starter
    `lykta.yaml`.
  - `lykta check`: validates the config against GitHub and reports every entry that cannot be found
    or read. The server runs the same check on start; `/readyz` stays not-ready, with a clear log
    message, until the configuration works.

### 6.4 Documentation deliverables

- README: what Lykta is, screenshots, quick start for each way of running it.
- `docs/configuration.md`: every setting, environment variable and default, with examples.
- `docs/github-app.md`: step by step: create the GitHub App (exact read-only permissions: Actions,
  Contents, Checks), install it in each organization, choose repositories, download the private key,
  store it (env var, file, or Kubernetes Secret).
- `docs/tokens.md`: the same for fine-grained personal access tokens.
- `docs/docker.md`: running the prebuilt image locally.
- `docs/kubernetes.md`: Helm values, secrets, probes, several instances; a complete **Argo CD**
  `Application` example; plain manifests.
- **Demo mode**: `lykta demo` serves the dashboard with the simulation (workflows starting, failing,
  recovering, long Android builds), for developing the layout and animations and for showing it off.

## 7. GitHub API facts this design relies on

Verified against docs.github.com on 2026-11-12. Lykta sends `X-GitHub-Api-Version: 2026-03-10`.

| Need | How | Source |
| --- | --- | --- |
| Latest runs per tile | `GET /repos/{o}/{r}/actions/workflows/{file}/runs?branch=…&per_page=5` (workflow id may be the file name). Fields: `status`, `conclusion`, `head_sha`, `head_branch`, `event`, `actor`, `triggering_actor`, `run_started_at`, `run_attempt`, `path`, `referenced_workflows[]` | [workflow runs](https://docs.github.com/en/rest/actions/workflow-runs) |
| Jobs and steps | `GET …/actions/runs/{id}/jobs?filter=latest&per_page=100` (paginate). Jobs carry `labels`, `runner_name`, `runner_group_name`, `steps[]` (number, name, status, conclusion, times). **No `needs`.** | [workflow jobs](https://docs.github.com/en/rest/actions/workflow-jobs) |
| Job graph | No API exposes it (REST or GraphQL). Fetch the workflow file at the run's commit: `GET …/contents/{run.path}?ref={head_sha}`, plus `referenced_workflows[]` for reusable workflows, and parse `needs`. | [GraphQL actions](https://docs.github.com/en/graphql/reference/actions) |
| Logs | `GET …/actions/jobs/{id}/logs` (302 to a 1-minute URL) and a per-step variant. No documented live log API; logs of a running job are not reliably available. | [run logs](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs) |
| Annotations | `GET …/check-runs/{check_run_id}/annotations`; take the id from the job's `check_run_url` (do not assume it equals the job id). | [check runs](https://docs.github.com/en/rest/checks/runs) |
| Rate limits | App installation: 5,000/h, rising with repos and users up to 12,500/h (15,000/h on Enterprise Cloud). PAT: 5,000/h per user. Secondary: 100 concurrent, 900 points/min. **304 Not Modified does not count** when authenticated. | [rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), [best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) |
| Permissions | App: Actions read, Contents read, Checks read. Fine-grained PAT: Actions read, Contents read (annotations not documented for PATs: best effort). | [app permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps) |
| Webhooks (later, not v1) | `workflow_run`, `workflow_job`: would only be a trigger to re-poll immediately. | [webhook events](https://docs.github.com/en/webhooks/webhook-events-and-payloads) |
| Not found | Private resources without access return 404. Workflow `state` (active, disabled_*, deleted) from `GET …/actions/workflows/{file}`. Missing permissions: 403 "Resource not accessible" with `X-Accepted-GitHub-Permissions`. | [troubleshooting](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api) |

Consequences for the design:

- **Live progress is step-level only.** While a job runs, Lykta shows its steps and timings; log excerpts
  appear when a job has finished (in particular for failures). No in-build percentage from logs.
- **Job graph = workflow file + name matching.** Matrix and reusable-workflow job names (for example
  `build (lynx, user)`, `caller / callee`) follow GitHub's display conventions, which are not
  documented. Lykta matches API jobs to graph nodes by job id and display-name prefix, and falls back
  to a flat, column-less list for anything it cannot place. Must be tested against real runs.
- **Polling budget.** ETags per URL, `If-None-Match` on every poll, a serial queue per token,
  `x-ratelimit-*` read on every response, `retry-after` honoured with exponential backoff. Since 304s
  are free, run lists can be polled every 15-30 s per tile; jobs of running runs every ~10-15 s.
  Example: 100 tiles, 12 running → mostly 304s on run lists, about 12 job fetches per cycle, well
  under 5,000/h.
- **Open points to test empirically before relying on them:** behaviour of the logs endpoint for a
  running job, job id vs check run id, matrix/reusable naming, PAT access to annotations.

## 8. Testing

- Mapper: fixtures of real-shaped GitHub responses (runs, jobs, workflow files with matrices,
  reusable workflows, re-runs, cancelled runs, not-found answers) → expected `DashboardState`.
- Workflow file parsing: `needs` (string and list), matrix expansion naming, reusable workflow calls.
- Layout function: state + screen size → densities, columns, pages.
- Expected duration and slow detection.
- Server: `DemoSource` driven end to end over SSE; reconnect and version-reload behaviour.
- No test depends on the network.
- **Fixtures** are captured from Kristofer's own `mklab-se` repositories (read-only, via the existing
  `gh` authentication): their release workflows have matrix builds, `needs` chains, and a reusable
  workflow call (`uses: ./.github/workflows/ci.yml`). This is also where the open points of section 7
  are tested. Android builds, ARC and lab runners are not available there, so those are synthetic
  fixtures shaped like the real responses.
- **Live test workflows in this repository** (`.github/workflows/live-*.yml`, Kristofer's addition):
  started manually (`workflow_dispatch`, with inputs such as "fail in job X" and "duration") and
  optionally on a schedule. Together they cover a `needs` chain, a matrix, a reusable workflow, a
  long-running job, a failure on demand, and a cancelled run, so Lykta can be watched against real
  runs end to end. They use GitHub-hosted runners and cheap steps (sleeps, echoes) only.
- The **GitHub App** path is tested by Kristofer creating an App in `mklab-se` with `docs/github-app.md`
  (which also tests the guide).

## 9. Postponed (tracked)

- AI explanation of failures: [issue #1](https://github.com/mklab-se/lykta/issues/1).
- Kubernetes node lookup for ARC jobs: [issue #2](https://github.com/mklab-se/lykta/issues/2).
- Authentication for dashboard viewers: [issue #3](https://github.com/mklab-se/lykta/issues/3).
- Check-run annotations on failure cards, and "slower than usual" per step (the run-level warning
  is in v1). Decided during the plan 2 review: the log excerpt already names the failing step.
- Workflows triggered by tags (an entry is a branch today; a release workflow on tags shows its
  runs only when it also runs on the branch).

## 10. Calls I made (for review)

- Cancelled runs do not count as failures; the previous completed result stands.
- A failing workflow that is re-running shows in both the failure band and the running list.
- Expected duration = median of the last 5 successful runs; slow at 125% (run) / 150% (step).
- Detail rotation 6-12 s; auto-close of overlays after 60 s; monitored pages every 12 s.
- Stale-data banner after 3 minutes; daily safety reload at 04:00.
- React 19 + Motion for the frontend; SSE (not WebSockets) for pushing state.
- `ignoreEvents` defaults to none; the example ignores manual runs.
- Visual language: the mockup's palette (red `#ff3d4d`, amber `#ffb224`, green `#2fe07f` on black)
  and fonts (Inter, JetBrains Mono), **self-hosted** (bundled), so an offline kiosk network works.
- Webhooks are not in v1 (polling only).
- Kristofer approved the calls in this section on 2026-11-12 ("okay with everything else").
- Helm chart (not Kustomize) as the Kubernetes packaging, because Argo CD and most tools consume it
  directly; plain manifests as a secondary example.
- Container image registry: **GitHub Container Registry** (`ghcr.io/mklab-se/lykta`, chart at
  `oci://ghcr.io/mklab-se/charts/lykta`), Kristofer's choice. Docker Hub may be added later.
