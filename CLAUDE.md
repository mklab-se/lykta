# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.

## What this is

`lykta` (Swedish for "lantern") is a highly visible dashboard for GitHub Actions workflows, meant
for wall-mounted monitors and TVs: failures must be impossible to ignore, and it gives an overview
of what the monitored workflows are doing. It is built on Bun and TypeScript from the `bun-templ`
template.

Status: the dashboard runs on real GitHub data (`lykta serve`, plan 2) and in demo mode (`lykta demo`,
plan 1). Packaging and the long-form docs (plan 3) follow. Design: `docs/superpowers/specs/2026-11-12-lykta-dashboard-design.md`
(approved); plans in `docs/superpowers/plans/`.

History: Lykta started as a Rust tool. `v0.0.1` (Rust) is published on crates.io as `lykta` and is
kept there on purpose to reserve the name; nothing Rust remains in this repo. On npm the package is
`@mklab-se/lykta` because the unscoped `lykta` belongs to someone else.

## Template lineage

<!-- lineage:start -->
> The references in this section intentionally point at the upstream template, not at this tool.

- **Upstream template:** https://github.com/mklab-se/bun-templ
- **Likely local clone:** `../bun-templ/` (sibling directory under the same parent)

Tools built from bun-templ share its conventions (layout, commander CLI, update checker, paths,
CI/release pipeline, `/release` skill). Use the lineage in both directions:

- **Pulling improvements in:** when the template gains a fix or new convention, compare against
  `../bun-templ/` and port the relevant change here, adapting the name to this tool.
- **Pushing improvements back:** if you find a fix or better pattern here that is _generic_ (not
  specific to this tool's domain), contribute it upstream to `mklab-se/bun-templ` so every future
  tool benefits. Strip tool-specific names and logic first.
<!-- lineage:end -->

## Architecture

TypeScript run directly by Bun; `bun build --compile` produces single-file binaries with the web app
(HTML, JS, CSS, fonts) embedded through Bun's HTML imports.

- `src/core/` (shared by server and browser; no DOM or server APIs):
  - `types.ts`: the data model (`RunRecord`, `JobRecord`, `EntryInput`, `EntryView`, `DashboardState`).
  - `state.ts`: `deriveEntry()`, which turns an entry's runs into what the wall shows (which
    conclusions count as failed, broken-since, history).
  - `timing.ts`: expected durations (median of the last 5 successes), slow detection, time labels.
  - `graph.ts`: the job graph model (columns by `needs`, matrix groups, collapsing).
- `src/server/`:
  - `source.ts`: the `Source` interface; `demo-source.ts` + `demo-data.ts` simulate workflows on a
    compressed clock (plan 2 adds the GitHub source).
  - `hub.ts`: in-memory state, derives `EntryView`s, notifies subscribers.
  - `http.ts`: Bun.serve routes: `/` (web app), `/events` (SSE snapshots, pings every 15 s),
    `/api/entries/:key/details`, `/healthz`, `/readyz`, and demo-only controls.
- `src/web/` (React 19 + Motion): `App.tsx` composes the three bands; `layout.ts` decides band sizes
  and densities (pure, tested); `stream.ts` (SSE, reconnect, version reload, stale banner, nightly
  reload); `canvas.ts` (virtual 1920-wide canvas); `power.ts` (low-power mode); `rotation.ts`,
  `focus.ts`, `idle.ts`; `holds.ts` (a finished run stays big for a while: which band each
  entry is in); components in `components/` (`ProgressStrip`: how far a run got;
  `FailureWhat`: failed job, step and error lines). `styles.css` holds all styles (only
  `transform`/`opacity` animate); `fonts.css` bundles Latin woff2 subsets.
- `src/server/config.ts`: `lykta.yaml` (or inline `LYKTA_CONFIG`) with defaults and `LYKTA_*`
  overrides; secrets only from env vars or `*_FILE` (`LYKTA_TOKEN_<ORG>`, `LYKTA_APP_ID`,
  `LYKTA_APP_PRIVATE_KEY`). Entry key `<repo>:<workflow>:<branch>`; one entry = one tile.
- `src/server/github/`:
  - `auth.ts`: per-org token or GitHub App (RS256 JWT via `node:crypto`, installation tokens cached).
  - `client.ts`: REST client, API version `2026-03-10`, one serial queue per org, ETags (304s are
    free), rate-limit tracking and waiting, never a token in errors.
  - `map.ts`: GitHub runs/jobs to the core model; runner classification (rules, GitHub-hosted via
    group "GitHub Actions", else self-hosted).
  - `workflow-file.ts`: the job graph from the workflow file at the run's commit; matches API job
    names (`Build x`, `Build (x)`, `Caller / Callee`) to definitions; falls back to a flat list.
  - `logs.ts`: cleans logs (BOM, ANSI, timestamps) and cuts the failing step's excerpt.
  - `source.ts`: `GitHubSource` polls (running every 15 s, idle every 60 s, doubled when the rate
    limit is below 20%), caches completed runs, turns 404/403 into visible problems.
- `src/commands/`: `serve.ts` (`lykta serve`), `check.ts` (`lykta check`: one real sync, prints
  what the wall would show), `init.ts` (`lykta init`), `demo.ts` (`lykta demo`).
- `test/fixtures/github/`: real runs recorded with `scripts/capture-fixture.ts` (uses your `gh`
  login); tests never touch the network. `.github/workflows/live-*.yml` are manual-only live test
  workflows, monitored by `lykta.example.yaml`.
- GitHub facts verified on real runs: reusable jobs are `Caller / Callee`; matrix names are the
  filled-in `name` template or `name (values)`; job id equals check-run id; `/rate_limit` has only
  `resources.core` in API 2026-03-10; logs start with a BOM.
- CLI plumbing from the template: `cli.ts`, `meta.ts`, `banner.ts`, `color.ts`, `paths.ts`,
  `config.ts`, `update.ts`, `commands/completion.ts`.
- `test/`: `bun test` (core, server, web pure functions and server-rendered components).
  `test/server/compiled.test.ts` builds the binary and runs only with `LYKTA_COMPILED_TEST=1`.
- Dev server: `bun --hot src/cli.ts demo` (`.claude/launch.json`). Hot reload swaps server code but
  keeps the old demo source alive; restart after changing server code.

## Adding a command

1. Create `src/commands/<name>.ts` exporting the logic (pure where possible).
2. Register it in `buildProgram()` in `src/cli.ts` with `.command()`, `.description()` (becomes the
   help text) and `.action()`.
3. Add tests in `test/`. Completions pick the command up automatically.

## Conventions

- Bun **latest** (CI installs `bun-version: latest`; `engines.bun` is the floor), TypeScript strict
  (`tsc --noEmit`, TypeScript 7), Biome for lint and format (2 spaces, width 100, double quotes).
- Prefer Bun built-ins over dependencies (`Bun.YAML`, `Bun.JSONC`, `Bun.semver`, `Bun.file`,
  `Bun.spawn`, `fetch`). Runtime dependencies today: `commander` only.
- Distribution: npm as `@mklab-se/<tool>` (the `bin` is the short name) via Trusted Publishing
  (GitHub OIDC, no stored token; see README "Releasing"), single-file binaries for
  4 targets on GitHub Releases with CycloneDX SBOMs, and the Homebrew tap `mklab-se/homebrew-tap`.
- CI gates (run them locally before pushing): `bun run lint`, `bun run typecheck`, `bun test`,
  `bun run build` (all at once: `bun run check && bun run build`).
- `README.md` opens with the logo, the badges and then a centred "What's new" callout
  (`<strong>tool X.Y</strong> is here: ...` plus a `What's new` link to `CHANGELOG.md`). Refresh the
  callout on every minor/major release.
- Releases go through the `/release` skill (`.claude/skills/release/`) → tag push → `release.yml`.
  The tag must equal `package.json`'s version (the workflow checks).

## Writing style

- **No em-dashes (U+2014), anywhere:** docs, CHANGELOG, code comments, help text, error messages,
  test strings, commit messages and PR descriptions. Use a comma where it works; otherwise a colon,
  parentheses, or a new sentence. If code genuinely needs the character at runtime, write the
  escape `\u2014`. CI enforces this; check locally with
  `grep -rn --exclude-dir=node_modules --exclude-dir=.git $'\xe2\x80\x94' .`

## Dependency Policy

Bun and every dependency run on their **latest** versions, not just versions that still work.
Letting them drift is how technical debt accumulates unnoticed until a security advisory or a
forced breaking upgrade makes it urgent. Every maintenance round and every release starts with
`bun upgrade` and `bun update --latest` (majors included), then the CI gates. A version may only be
held back with a concrete, documented reason next to it.
