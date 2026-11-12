<p align="center"><img src="https://raw.githubusercontent.com/mklab-se/lykta/main/media/lykta-horizontal.png" width="600"></p>

<p align="center">
<a href="https://github.com/mklab-se/lykta/actions/workflows/ci.yml"><img src="https://github.com/mklab-se/lykta/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
<a href="https://crates.io/crates/lykta"><img src="https://img.shields.io/crates/v/lykta.svg" alt="crates.io"></a>
<a href="https://github.com/mklab-se/lykta/releases/latest"><img src="https://img.shields.io/github/v/release/mklab-se/lykta" alt="GitHub Release"></a>
<a href="https://github.com/mklab-se/homebrew-tap/blob/main/Formula/lykta.rb"><img src="https://img.shields.io/badge/dynamic/regex?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmklab-se%2Fhomebrew-tap%2Fmain%2FFormula%2Flykta.rb&search=%5Cd%2B%5C.%5Cd%2B%5C.%5Cd%2B&label=homebrew&prefix=v&color=orange" alt="Homebrew"></a>
<a href="https://github.com/mklab-se/lykta/blob/main/LICENSE"><img src="https://img.shields.io/crates/l/lykta.svg" alt="License"></a>
</p>

<!-- "What's new" callout: keep it right after the badges and refresh it on every minor/major
     release (version and a one-line summary of the headline changes). Only link CHANGELOG.md. -->
<p align="center">
  <strong>lykta 0.0.1</strong> is here: the name is claimed and the scaffold is in place.
  The workflow dashboard itself is next.<br>
  <a href="CHANGELOG.md"><strong>What's new</strong></a>
</p>

# lykta

**Lykta** (Swedish for *lantern*) is a highly visible, easy-to-read dashboard for **GitHub Actions
workflows**. Put it on a screen and anyone walking past can see what is running, what has failed and
what is green, without opening a browser tab.

> **Status:** early days. `0.0.1` reserves the name and ships the standard MKLab CLI plumbing; the
> dashboard is under active development.

Planned:

- 🏮 A full-screen terminal dashboard of workflow runs across your repositories
- 🔴 Failures that stand out from across the room; 🟡 running and queued runs; 🟢 the rest
- 🔁 Live refresh from the GitHub API

Already in place (shared with the other MKLab CLIs):

- 🤖 An `ai` subcommand backed by [**Ailloy**](https://crates.io/crates/ailloy), MKLab's shared AI config
- 🐚 Static **and** dynamic shell completions
- 🔔 A background **crates.io update checker** (disable with `LYKTA_NO_UPDATE_CHECK=1`)

## Build & run

```sh
cargo run                    # banner (the dashboard will launch here)
cargo run -- --help          # show the CLI help
cargo run -- version         # banner + version
cargo run -- ai              # AI status (via Ailloy)
cargo run -- completion zsh  # generate a zsh completion script
cargo test --workspace       # run the unit tests
```

### Install

See [INSTALL.md](INSTALL.md) for Homebrew, `cargo install`, `cargo binstall`, and from-source instructions.

## AI integration (Ailloy)

The `ai` subcommand reuses MKLab's shared [Ailloy](https://crates.io/crates/ailloy) configuration
(`~/.config/ailloy/config.yaml`), so every tool shares the same providers and API keys.

```sh
lykta ai          # show status
lykta ai config   # interactively configure a provider/model
lykta ai test     # send a test message
lykta ai enable   # / disable: toggle AI for this tool
```

To call a model from your own commands, use `ailloy::Client`; see `crates/lykta/src/commands/ai.rs`
for where the integration lives.

## Releasing

Releases are driven by the [`/release`](.claude/skills/release/SKILL.md) skill (run it in Claude
Code with `major`, `minor`, or `patch`). It updates the toolchain and dependencies, runs the CI
gates, bumps the version, updates the changelog, then commits, pushes, and tags `vX.Y.Z`. Pushing
the tag triggers `.github/workflows/release.yml`, which:

1. Re-runs the full CI suite
2. Builds [auditable](https://github.com/rust-secure-code/cargo-auditable) binaries for Linux, macOS
   (Intel + ARM), and Windows, with a CycloneDX SBOM per target
3. Creates a GitHub Release with the archives and SBOMs (see
   [INSTALL.md](INSTALL.md#software-bill-of-materials-sbom) for how to read them)
4. Publishes `lykta-core` then `lykta` to crates.io
5. Updates the Homebrew formula in [`mklab-se/homebrew-tap`](https://github.com/mklab-se/homebrew-tap)

### Required secrets

Configure these once on the GitHub repository (these are the same secrets used by the other MKLab tools):

| Secret | Where | Purpose | How to create |
| --- | --- | --- | --- |
| `CARGO_REGISTRY_TOKEN` | Environment **`crates-io`** | Publish to crates.io | [crates.io/settings/tokens](https://crates.io/settings/tokens) → new token with publish scope |
| `HOMEBREW_TAP_TOKEN` | Repository secret | Push the formula to the tap | A GitHub PAT with `repo` scope for `mklab-se/homebrew-tap` |

If `HOMEBREW_TAP_TOKEN` is missing, the release still succeeds; the Homebrew step just logs a warning.

## Development

```sh
cargo fmt --all              # format
cargo clippy --workspace --all-targets -- -D warnings   # lint (matches CI)
cargo test --workspace       # test
```

The CLI lives in `crates/lykta` and reusable logic in `crates/lykta-core`. To add a
command: declare it in `cli.rs` (`Commands` enum), add a module under `commands/`, and wire the
dispatch arm in `Cli::run`. See [CLAUDE.md](CLAUDE.md) for the architecture in more detail.

## License

[MIT](LICENSE) © Kristofer Liljeblad
