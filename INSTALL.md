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

## Cargo (from crates.io)

```sh
cargo install lykta
```

On Windows, building from source needs [NASM](https://www.nasm.us/) and [CMake](https://cmake.org/)
on `PATH` (plus the Visual Studio Build Tools most Rust installs already have). They're needed to
compile [`aws-lc-rs`](https://github.com/aws/aws-lc-rs), the TLS crypto backend. macOS and Linux need
nothing extra. If you'd rather skip the build tools entirely, use `cargo binstall` or Homebrew below:
both fetch a pre-built binary.

## cargo-binstall (prebuilt binaries, no compilation)

```sh
cargo binstall lykta
```

## Prebuilt binaries (GitHub Releases)

Download the archive for your platform from the
[latest release](https://github.com/mklab-se/lykta/releases/latest), extract it, and put the
`lykta` binary somewhere on your `PATH`:

| Platform | Archive |
| --- | --- |
| Linux (x86-64) | `lykta-vX.Y.Z-x86_64-unknown-linux-gnu.tar.gz` |
| macOS (Apple Silicon) | `lykta-vX.Y.Z-aarch64-apple-darwin.tar.gz` |
| macOS (Intel) | `lykta-vX.Y.Z-x86_64-apple-darwin.tar.gz` |
| Windows (x86-64) | `lykta-vX.Y.Z-x86_64-pc-windows-msvc.zip` |

## Software bill of materials (SBOM)

Every release asset above has a matching CycloneDX 1.5 SBOM listing the exact crate versions
compiled into that platform's binary:

```
lykta-vX.Y.Z-<target>.cdx.json
```

The binaries are also built with [`cargo auditable`](https://github.com/rust-secure-code/cargo-auditable),
so the dependency list travels inside the executable itself. Check a downloaded binary against the
RustSec advisory database with:

```sh
cargo install cargo-audit --features=fix
cargo audit bin ./lykta
```

`syft` and `trivy` also understand this format.

## From source

```sh
git clone https://github.com/mklab-se/lykta
cd lykta
cargo install --path crates/lykta
```

## Shell completions

```sh
# Static script (write it where your shell loads completions)
lykta completion zsh > ~/.zfunc/_lykta

# Or dynamic completions (re-evaluated on each tab)
source <(COMPLETE=zsh lykta)
```
