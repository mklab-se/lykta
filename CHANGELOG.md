# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `lykta serve --config lykta.yaml`: the dashboard on real GitHub Actions data, from several
  organizations, signing in with a GitHub App (recommended) or fine-grained tokens. Polls within
  rate limits (cheap repeat requests, slows down when the limit runs low, shows a warning instead
  of failing), builds each running workflow's job graph from its workflow file (matrices and
  reusable workflows included), shows the failing step's log lines, and turns missing, disabled
  or inaccessible workflows into visible problems. A "Connecting to GitHub..." screen shows until
  the first sync.
- `lykta check` verifies a configuration against GitHub and prints what the wall would show;
  `lykta init` writes a starter `lykta.yaml`.
- Live test workflows in this repository and `lykta.example.yaml` monitoring them.

- The dashboard (Command Center layout) with `lykta demo`, driven by simulated workflows: failures
  pinned at the top with broken-for, failing job and step, runner and log excerpt; every running
  workflow in a list with progress against its usual duration and expected finish, and rotating
  details (job graph with matrix groups and collapsing, step lanes, where each job runs, "slower
  than usual"); all monitored workflows as tiles with recent history, shrinking and paging as the
  screen gets busy.
- Morph animations between bands, burn-in drift, and an automatic low-power mode for weak screens.
- Detail overlay on click or keyboard, with a QR code to the run; closes after 60 s without input.
- Kiosk behaviour: SSE with reconnect, reload on a new server version, a stale-data banner, and a
  nightly safety reload. Health (`/healthz`) and readiness (`/readyz`) endpoints.
- The web app, styles and fonts are embedded in the single-file binary.

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
