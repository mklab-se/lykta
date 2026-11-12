# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.3] - 2026-11-12

### Changed

- npm releases are published with Trusted Publishing: the release workflow authenticates to npm
  through GitHub's OIDC token, so no npm token is stored, and every version carries a signed
  provenance statement.

## [0.0.2] - 2026-11-12

### Changed

- Lykta is now built on Bun and TypeScript, scaffolded from the MKLab `bun-templ` template: a
  commander CLI with `version` and `completion` commands, an npm update checker, single-file
  binaries for 4 platforms with CycloneDX SBOMs, npm (`@mklab-se/lykta`) and Homebrew publishing.
  The Rust implementation is gone; the `lykta` 0.0.1 crate stays on crates.io to reserve the name.

## [0.0.1] - 2026-11-12

### Added

- Initial Rust release, reserving the `lykta` name on crates.io.

[Unreleased]: https://github.com/mklab-se/lykta/compare/v0.0.3...HEAD
[0.0.3]: https://github.com/mklab-se/lykta/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/mklab-se/lykta/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/mklab-se/lykta/releases/tag/v0.0.1
