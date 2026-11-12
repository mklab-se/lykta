<p align="center"><img src="https://raw.githubusercontent.com/mklab-se/lykta/main/media/lykta-horizontal.png" width="600"></p>

<p align="center">
<a href="https://github.com/mklab-se/lykta/actions/workflows/ci.yml"><img src="https://github.com/mklab-se/lykta/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
<a href="https://www.npmjs.com/package/@mklab-se/lykta"><img src="https://img.shields.io/npm/v/@mklab-se/lykta.svg" alt="npm"></a>
<a href="https://github.com/mklab-se/lykta/releases/latest"><img src="https://img.shields.io/github/v/release/mklab-se/lykta" alt="GitHub Release"></a>
<a href="https://github.com/mklab-se/homebrew-tap/blob/main/Formula/lykta.rb"><img src="https://img.shields.io/badge/dynamic/regex?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmklab-se%2Fhomebrew-tap%2Fmain%2FFormula%2Flykta.rb&search=%5Cd%2B%5C.%5Cd%2B%5C.%5Cd%2B&label=homebrew&prefix=v&color=orange" alt="Homebrew"></a>
<a href="https://github.com/mklab-se/lykta/blob/main/LICENSE"><img src="https://img.shields.io/github/license/mklab-se/lykta" alt="License"></a>
</p>

<!-- "What's new" callout: keep it right after the badges and refresh it on every minor/major
     release (version and a one-line summary of the headline changes). Only link CHANGELOG.md. -->
<p align="center">
  <strong>lykta 0.0.2</strong> is here: Lykta is now built on Bun and TypeScript. The workflow
  dashboard itself is next.<br>
  <a href="CHANGELOG.md"><strong>What's new</strong></a>
</p>

# lykta

**Lykta** (Swedish for *lantern*) is a highly visible, easy-to-read dashboard for **GitHub Actions
workflows**, made for wall-mounted monitors and TVs. Anyone walking past the screen should see at
once what is running, what has failed and what is green, and feel an urge to fix what is broken.

> **Status:** the dashboard runs with simulated workflows (`lykta demo`). Connecting it to GitHub
> is next; until then it shows what Lykta will look like on your wall.

## Try the demo

```sh
bunx @mklab-se/lykta demo          # or: brew install mklab-se/tap/lykta && lykta demo
```

Open <http://localhost:8080> (full screen works best). The demo simulates workflows across
repositories: long Android builds, matrix builds, ARC and lab runners, runs that fail and recover.
Move the mouse to show the demo bar (how many workflows run at once, or "Break one").

`lykta demo --count 100 --running 12` shows a busy day; `--low-power` forces the reduced-motion mode
used on weak screens.

## Try it against GitHub

This repository has live sample workflows (`.github/workflows/live-*.yml`: a pipeline with a
matrix and a reusable workflow, an Android-style nightly, a deploy chain, a security scan with
parallel jobs, a release dry run, flaky integration checks, docs and a quick one) and an example
configuration that monitors them. They are manual only and just `echo` and `sleep`; most take a
`fail` input. With the [GitHub CLI](https://cli.github.com) signed in:

```sh
LYKTA_TOKEN_MKLAB_SE=$(gh auth token) lykta serve --config lykta.example.yaml
gh workflow run live-pipeline.yml -R mklab-se/lykta -f fail_at=build -f minutes=4
gh workflow run live-deploy.yml -R mklab-se/lykta -f fail=true
```

For your own workflows: `lykta init` writes a starter `lykta.yaml`, and `lykta check` verifies it
against GitHub before it goes on a wall.

## Configuration

A YAML file (`lykta.yaml`, or the whole file in `LYKTA_CONFIG`); see
[`lykta.example.yaml`](lykta.example.yaml). Secrets never go in the file:

| Organization signs in with | Set |
| --- | --- |
| a fine-grained token | `LYKTA_TOKEN_<ORG>` (e.g. `LYKTA_TOKEN_MKLAB_SE`), or `LYKTA_TOKEN_<ORG>_FILE` |
| a GitHub App | `LYKTA_APP_ID` and `LYKTA_APP_PRIVATE_KEY` (or `LYKTA_APP_PRIVATE_KEY_FILE`) |

Each entry under `monitor` is one tile: a repository, a workflow file and a branch (default
`main`). Watching the same workflow on another branch is another entry. `LYKTA_PORT`,
`LYKTA_HOST`, `LYKTA_TITLE` and `LYKTA_LOW_POWER` override the file.

Lykta shares each organization's GitHub rate limit with everyone else using it (other teams'
tools, other Lykta walls). It stays sparse on purpose: unchanged answers (`304`) are free, and it
slows down as soon as less than half of the limit is left, or when its own use in the last hour
nears `polling.budget` (default `0.2`, a fifth of the hourly limit). When GitHub says to slow
down, Lykta stops calling that organization until the reset and keeps showing the last known
state with a warning.

```yaml
polling:
  activeSeconds: 15 # running workflows
  idleSeconds: 60 # waiting for new runs
  budget: 0.2 # share of each organization's hourly rate limit Lykta may use
```

When a run you were watching finishes, it stays big where it was: a failure for 3 minutes (red,
the whole job graph with the failed job marked, and the error message), a pass for 45 seconds.
Then it shrinks into its failure card or tile. Failure cards show how far the run got (a strip
of passed, failed and never-run jobs) and the error message itself as their biggest text.

```yaml
display:
  holdFailedSeconds: 180 # a failed run stays big this long (0: shrink at once)
  holdPassedSeconds: 45 # a passed run, the same
```

## What it shows

- 🔴 **Needs fixing:** failed workflows, and configured workflows that cannot be found, with how long
  they have been broken, the failing job and step, where it ran, and the log lines around the error.
  They never leave the screen; with many failures they become dense rows.
- 🟡 **In progress:** every running workflow in a list, with progress against its usual duration and
  the expected finish time; the details of each are shown in turn: the job graph (matrices folded,
  long pipelines collapsed around the active part), a lane per running job with its steps, and
  where each job runs (GitHub-hosted, Kubernetes/ARC, or a lab bench and its device).
- 🟢 **All monitored:** everything else, as large tiles with recent history when it is calm, and as
  compact cells (paging if needed) when it is busy.
- Click or use the arrow keys and Enter for details (with a QR code to open the run on your phone);
  everything closes after a minute without input.
- Made for kiosks: recovers by itself after network drops and restarts, reloads when a new version
  is deployed, guards against burn-in, and switches to a low-power mode on slow hardware.

## Build & run

```sh
bun install                    # install dependencies
bun start demo                 # the dashboard with simulated workflows on :8080
bun start --help               # show the CLI help
bun start version              # banner + version
bun start completion zsh       # generate a zsh completion script
bun test                       # run the tests
bun run build                  # compile dist/lykta (single-file binary)
```

### Install

See [INSTALL.md](INSTALL.md) for Homebrew, npm/bun, prebuilt binaries and from-source instructions.

## Releasing

Releases are driven by the [`/release`](.claude/skills/release/SKILL.md) skill (run it in Claude
Code with `major`, `minor`, or `patch`). It upgrades Bun and every dependency to the latest
version, runs the CI gates, bumps the version, updates the changelog, then commits, pushes, and
tags `vX.Y.Z`. Pushing the tag triggers `.github/workflows/release.yml`, which:

1. Re-runs the full CI suite and checks the tag matches `package.json`
2. Compiles single-file binaries for Linux, macOS (Intel + ARM, ad-hoc signed) and Windows, with a
   CycloneDX SBOM per target
3. Creates a GitHub Release with the archives and SBOMs
4. Publishes `@mklab-se/lykta` to npm with provenance
5. Updates the Homebrew formula in [`mklab-se/homebrew-tap`](https://github.com/mklab-se/homebrew-tap)

### Required secrets

| Secret               | Where                 | Purpose                     | How to create                                                                           |
| -------------------- | --------------------- | --------------------------- | --------------------------------------------------------------------------------------- |
| `HOMEBREW_TAP_TOKEN` | Repository secret     | Push the formula to the tap | A GitHub PAT with `repo` scope for `mklab-se/homebrew-tap`                              |

If `HOMEBREW_TAP_TOKEN` is missing, the release still succeeds; the Homebrew step just logs a warning.

### npm: Trusted Publishing

npm publishing needs **no stored secret**. The workflow proves its identity to npm with GitHub's
OIDC token (Trusted Publishing), and npm attaches a signed provenance statement to every version.
On npmjs.com, under the package's **Settings > Trusted Publisher**, add GitHub Actions with
organization `mklab-se`, repository `lykta`, workflow `release.yml`, environment `npm`, and tick
**Allow npm publish**. The GitHub repository needs an environment named `npm` (it may be empty).

npm can only attach a trusted publisher to a package that already exists, so a **brand-new**
package is published once with a token: put a short-lived granular token (read and write on the
`@mklab-se` scope) in the `npm` environment as `NPM_TOKEN`, release, set up Trusted Publishing as
above, then delete the secret and revoke the token.

## Development

```sh
bun run format                 # format and fix with Biome
bun run check                  # typecheck + lint + test (matches CI)
bun run build                  # compile the binary
```

The CLI is defined in `src/cli.ts`; commands live in `src/commands/`. See [CLAUDE.md](CLAUDE.md)
for the architecture in more detail.

## License

[MIT](LICENSE) © Kristofer Liljeblad
