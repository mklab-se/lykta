---
name: release
description: "Release a new version: upgrade Bun and dependencies, bump version, update docs, commit, push, tag, and verify the release workflow"
argument-hint: "<major|minor|patch>"
---

Release a new version of lykta.

## Input

$ARGUMENTS must be one of: `major`, `minor`, `patch`. If empty or invalid, stop and ask.

## Steps

### 1. Determine the new version

- Read the current `version` from `package.json`
- Apply the semver bump: `patch` 0.1.0 -> 0.1.1, `minor` 0.1.0 -> 0.2.0, `major` 0.1.0 -> 1.0.0
- Show the user: "Releasing lykta v{OLD} -> v{NEW}"

### 2. Upgrade Bun and every dependency to the latest version

- `bun upgrade`, then confirm with `bun --version`. CI installs the latest Bun, so testing locally on
  an older one lets breakage through to the release workflow
- `bun update --latest` (majors included; this rewrites the ranges in `package.json`). Then
  `bun outdated` must list nothing. Hold a package back only with a concrete reason written next to
  it in `CLAUDE.md`'s Dependency Policy
- If a major changed, read its release notes and fix any fallout before continuing

### 3. Pre-flight checks

- `bun run format`, then `bun run check` (typecheck + lint + test): abort on any failure
- `bun run build && ./dist/lykta --version`: the compiled binary must run
- `grep -rn --exclude-dir=node_modules --exclude-dir=.git $'\xe2\x80\x94' .` must print nothing
- `git status`: abort if there are uncommitted changes that are NOT docs, version, or dependency files

### 4. Bump the version

- Set `version` in `package.json` (the CLI, the update checker and the SBOM all read it from there)

### 5. Update documentation

- **CHANGELOG.md**: rename `[Unreleased]` to `[{NEW}] - {TODAY}` (YYYY-MM-DD), add a fresh empty
  `## [Unreleased]` above it, and update the compare links at the bottom
- **README.md "What's new" callout**: on every minor or major release, update the version in
  `<strong>...</strong>` and the one-line summary; keep the `What's new` link
- **README.md, CLAUDE.md, INSTALL.md**: review for accuracy

### 6. Commit, push, and tag

- Stage `package.json`, `bun.lock`, `CHANGELOG.md` and any updated docs
- Commit `Release v{NEW}`, `git push`, then `git tag v{NEW} && git push origin v{NEW}`

### 7. Watch and verify

- The tag push triggers the Release workflow. Do NOT declare success yet: find it with
  `gh run list --repo mklab-se/lykta --workflow release.yml --limit 1`, then
  `gh run watch <id> --repo mklab-se/lykta --exit-status`
- On failure: `gh run view <id> --log-failed`, fix the cause, and re-release as a patch
- When green, confirm:
  - `gh release view v{NEW} --repo mklab-se/lykta --json assets -q '.assets[].name'` lists
    3 `.tar.gz`, 1 `.zip` and 4 `.cdx.json`
  - `npm view @mklab-se/lykta version` shows {NEW} (unless the npm step warned that `NPM_TOKEN`
    is missing)
  - `Formula/lykta.rb` in `mklab-se/homebrew-tap` carries {NEW}

### 8. Confirm

- Tell the user the release is tagged and the workflow is green: binaries and SBOMs on the GitHub
  Release, npm published, Homebrew tap updated. Mention any step that only warned
