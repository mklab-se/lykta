# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `lykta serve --config lykta.yaml`: the dashboard on real GitHub Actions data, from several
  organizations, signing in with a GitHub App (recommended) or fine-grained tokens. Polls
  sparingly, since other teams and other walls share the same rate limits: cheap repeat requests,
  at most a share of each organization's hourly limit (`polling.budget`, default 20%), slower as
  soon as under half is left, and a pause with a warning (never a retry storm) when GitHub says
  to slow down. A re-run of a failed workflow keeps the failure on the wall until it decides. Builds each running workflow's job graph from its workflow file (matrices and
  reusable workflows included), shows the failing step's log lines, and turns missing, disabled
  or inaccessible workflows into visible problems. A "Connecting to GitHub..." screen shows until
  the first sync.
- A new wall: **the track and the pit**. Every workflow has a fixed place in a grid that keeps its
  shape; failures move to the pit on the left and leave a gap. Running tiles glow yellow with
  their progress, and every 20 seconds one running workflow opens as a large diagram over the
  blurred track (`display.spotlightSeconds`, `display.spotlightEverySeconds`); a finished run gets
  one last turn before a failure enters the pit. History strips always show the last 10 results.
- Labels and colors: teams sharing a wall give their workflows `labels` (shown as `#hashtags` in
  the tile's corner) and a `color` (the tags become luggage tags in that color), per workflow or as
  defaults. Tiles follow
  the order of the configuration file; the track is labelled THE GRID, the pit THE PIT.
- A lantern: Lykta's mark in the header (its flame sways slowly) and as the browser tab's icon.
- Where a workflow failed is visible from across the room: pit cards show a strip of the run's
  jobs (passed green, failed red, never run dim) and the error message itself as their biggest
  text.
- `lykta check` verifies a configuration against GitHub and prints what the wall would show;
  `lykta init` writes a starter `lykta.yaml`.
- Live test workflows in this repository and `lykta.example.yaml` monitoring them.

- The dashboard with `lykta demo`, driven by simulated workflows: job graphs with matrix groups
  and collapsing, step lanes, where each job runs, progress against the usual duration and
  "slower than usual".
- Morph animations, burn-in drift, and an automatic low-power mode for weak screens.
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
