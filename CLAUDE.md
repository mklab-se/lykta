# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.

## What this is

`lykta` (Swedish for "lantern") is a highly visible dashboard for GitHub Actions workflows, meant
for wall-mounted monitors and TVs: failures must be impossible to ignore, and it gives an overview
of what the monitored workflows are doing. It is built on Bun and TypeScript from the `bun-templ`
template.

Status: `0.0.2` is the template plumbing only (the no-command action prints the banner and a
"coming soon" note). The dashboard is being designed from Kristofer's requirements; do not assume
a design before it is agreed.

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

TypeScript run directly by Bun (no build step for development); `bun build --compile` produces the
single-file release binaries.

- `src/cli.ts`: entry point (`#!/usr/bin/env bun`). `buildProgram()` defines the commander CLI;
  `main()` parses, applies global flags, and awaits the background update check for at most 1.5 s.
  The no-command action prints the banner and a "coming soon" note; it is where the
  dashboard will start. `--help`/`-h` and `--version`/`-V` come from commander.
- `src/commands/`: one module per command (`completion.ts` today). Add new commands here.
- `src/meta.ts`: tool name, package name, version and description (version and description are
  read from `package.json`, the single source of truth).
- `src/banner.ts`: block-letter banner rendered at runtime from the tool name via a built-in 5-row
  font, so a rename needs no ASCII art.
- `src/color.ts`: tiny ANSI helpers; colour only on a TTY, off with `NO_COLOR` or `--no-color`.
- `src/paths.ts`: where the tool keeps files. Linux and macOS share the XDG layout (same as the
  Rust tools and Ailloy): `$XDG_CONFIG_HOME/<tool>` or `~/.config/<tool>`, `$XDG_CACHE_HOME/<tool>`
  or `~/.cache/<tool>`. Windows uses `%APPDATA%` / `%LOCALAPPDATA%`. Never `~/Library/...`.
- `src/config.ts`: YAML config in `configDir()/config.yaml` via the built-in `Bun.YAML`.
- `src/update.ts`: checks the npm registry for a newer version, caches the answer for 24 h in
  `cacheDir()`, never throws. Disabled by `-q` or the `<TOOL>_NO_UPDATE_CHECK` env var.
- `scripts/sbom.ts`: CycloneDX 1.5 SBOM per release target (Bun runtime + production deps from
  `bun.lock`).
- `test/`: `bun test` suites. Keep logic in pure functions with injectable inputs (env, clock,
  fetch) so it is testable without the network.

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
- Distribution: npm as `@mklab-se/<tool>` (the `bin` is the short name), single-file binaries for
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
