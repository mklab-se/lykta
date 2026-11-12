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

> **Status:** early days. `0.0.2` moves Lykta to Bun and TypeScript and ships the standard MKLab
> tool plumbing; the dashboard is being designed now.

Planned:

- 🏮 A kiosk-style web dashboard of monitored workflows across repositories and organizations
- 🔴 Failures that stand out from across the room, with the failing job, step and log excerpt
- 🟡 Running workflows as a live job graph; 🟢 idle and never-run workflows in compact form
- 🔁 Polling within GitHub rate limits (works behind firewalls), optional webhooks
- 🐳 Runs with `bun` locally or in a container on Kubernetes

## Build & run

```sh
bun install                    # install dependencies
bun start                      # banner (the dashboard will start here)
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
