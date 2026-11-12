# Installing lykta

## Homebrew (macOS / Linux)

```sh
brew install mklab-se/tap/lykta
```

Or add the tap once, then install:

```sh
brew tap mklab-se/tap
brew install lykta
```

Upgrade with `brew upgrade lykta`.

## npm / Bun (needs [Bun](https://bun.com) installed)

```sh
bun add -g @mklab-se/lykta     # installs the `lykta` command
bunx @mklab-se/lykta --help    # or run it without installing
```

The package runs its TypeScript sources with Bun, so `npm install -g` also works as long as `bun`
is on your `PATH`.

## Prebuilt binaries (GitHub Releases)

Download the archive for your platform from the
[latest release](https://github.com/mklab-se/lykta/releases/latest), extract it, and put the
`lykta` binary somewhere on your `PATH`. The binaries are self-contained (the Bun runtime is
embedded), so Bun does not need to be installed.

| Platform              | Archive                                            |
| --------------------- | -------------------------------------------------- |
| Linux (x86-64)        | `lykta-vX.Y.Z-x86_64-unknown-linux-gnu.tar.gz` |
| macOS (Apple Silicon) | `lykta-vX.Y.Z-aarch64-apple-darwin.tar.gz`     |
| macOS (Intel)         | `lykta-vX.Y.Z-x86_64-apple-darwin.tar.gz`      |
| Windows (x86-64)      | `lykta-vX.Y.Z-x86_64-pc-windows-msvc.zip`      |

## Software bill of materials (SBOM)

Every archive above has a matching CycloneDX 1.5 SBOM listing what is compiled into that binary:
the embedded Bun runtime version and the exact production dependencies from `bun.lock`.

```
lykta-vX.Y.Z-<target>.cdx.json
```

`syft`, `grype` and `trivy` understand this format, e.g. `grype sbom:./lykta-vX.Y.Z-<target>.cdx.json`.

## From source

```sh
git clone https://github.com/mklab-se/lykta
cd lykta
bun install
bun run build          # writes dist/lykta
```

## Shell completions

```sh
lykta completion zsh > ~/.zfunc/_lykta
lykta completion bash > ~/.local/share/bash-completion/completions/lykta
lykta completion fish > ~/.config/fish/completions/lykta.fish
```
