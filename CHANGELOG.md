# agent-gauntlet

## 0.9.0

### Minor Changes

- [#29](https://github.com/pacaplan/agent-gauntlet/pull/29) [`33f88fa`](https://github.com/pacaplan/agent-gauntlet/commit/33f88fa07a88217415214fe9d0c87bc3a84e6c0a) Thanks [@pacaplan](https://github.com/pacaplan)! - ### Features

  - feat: implement auto-fix-pr feature for autonomous CI monitoring

  ### Fixes

  - fix: correct wait-ci API response parsing and add docs

  ### Other Changes

  - chore: change cli pref
  - spec: update the proposal
  - spec: update the proposal
  - spec: archive changes

- ### Features

  - feat: add cursor stop hook

  ### Fixes

  - fix: resolve merge conflict and update rerun_new_issue_threshold docs
  - fix: include stderr in adapter error messages for usage limit detection
  - fix: prevent stale execution state from causing false auto-clean and phantom diffs

  ### Other Changes

  - refactor: improve code health in stop-hook-handler
  - chore: add changeset
  - spec: update cursor stop hook spec
  - chore: add changeset
  - spec: cursor stop hook

- [#30](https://github.com/pacaplan/agent-gauntlet/pull/30) [`78637c7`](https://github.com/pacaplan/agent-gauntlet/commit/78637c79cdac0a514f8c96075bab06a08ce57c09) Thanks [@pacaplan](https://github.com/pacaplan)! - ### Fixes

  - fix: prevent clean command from running during active gauntlet run
  - fix: regenerate changeset
  - fix: properly skip unhealthy adapters

  ### Other Changes

  - chore: include GitHub Actions failure logs in CI fix instructions
  - chore: add CodeScene code health rules configuration
  - refactor: improve code health and fix review violations
  - Address PR review comments and fix CI failures
  - chore: add changeset for global adapter state
  - Clarify OpenSpec updates and refactor adapter streaming
  - chore: change cli pref
  - spec: move unhealthy adapter state

- [#25](https://github.com/pacaplan/agent-gauntlet/pull/25) [`ce16800`](https://github.com/pacaplan/agent-gauntlet/commit/ce16800c662d89cd19a1243f6c0d6e2eb9669bdf) Thanks [@pacaplan](https://github.com/pacaplan)! - ### Features

  - feat: implement auto_push_pr stop hook workflow

  ### Other Changes

  - refactor: reduce cyclomatic complexity in init and stop-hook
  - Address PR review comments and resolve merge conflict
  - spec: pr workflows

### Patch Changes

- [#27](https://github.com/pacaplan/agent-gauntlet/pull/27) [`20bfb53`](https://github.com/pacaplan/agent-gauntlet/commit/20bfb5389b625743092962bee4e1afde1fb3f8ee) Thanks [@pacaplan](https://github.com/pacaplan)! - ### Fixes

  - fix: include stderr in adapter error messages for usage limit detection
  - fix: prevent stale execution state from causing false auto-clean and phantom diffs

  ### Other Changes

  - chore: add changeset

## 0.8.0

### Minor Changes

- [#22](https://github.com/pacaplan/agent-gauntlet/pull/22) [`c9df146`](https://github.com/pacaplan/agent-gauntlet/commit/c9df14610412d8ac29a4b33f61f1dc514b8b082b) Thanks [@pacaplan](https://github.com/pacaplan)! - ### Features

  - feat: replace preflight phase with runtime cooldown-based adapter filtering

  ### Other Changes

  - chore: add changeset for remove-pre-flight
  - spec: add migration scenario to REMOVED preflight requirement
  - spec: remove preflight checks

## 0.7.1

### Patch Changes

- [#21](https://github.com/pacaplan/agent-gauntlet/pull/21) [`50efe13`](https://github.com/pacaplan/agent-gauntlet/commit/50efe13ef843746a62dbdeb224badaa232b96c44) Thanks [@pacaplan](https://github.com/pacaplan)! - ### Fixes

  - fix: add timeout for adapters

  ### Other Changes

  - chore: add run duration to debug log
  - spec: archive changes
  - chore: add codescene health check
  - chore: fix test
  - chore: fix test

## 0.7.0

### Minor Changes

- [#19](https://github.com/pacaplan/agent-gauntlet/pull/19) [`cf9d924`](https://github.com/pacaplan/agent-gauntlet/commit/cf9d924a6b1d215e1200b8950f30c60403258e19) Thanks [@pacaplan](https://github.com/pacaplan)! - ### Features

  - Add structured logging via LogTape with stop-hook support
  - Extend stop hook configuration with `enabled` flag and environment variable overrides
  - Adopt Changesets for release workflow
  - Lower default run interval
  - Ask for base branch during init
  - Add prompt configurability

  ### Fixes

  - Harden stop hook against race conditions and improve diagnostics
  - Add `run_in_ci` default to test helper for CI stability
  - De-dupe jobs by working directory
  - Suppress LogTape meta logger stdout and expose `intervalMinutes` in stop-hook
  - Add status icons and `systemMessage` to stop-hook output

  ### Refactors

  - Simplify stop-hook by delegating interval check to executor
  - CodeScene hotspot pre-factoring

  ### CI

  - Add GitHub Releases on publish

## 0.6.0

### Minor Changes

- [#12](https://github.com/pacaplan/agent-gauntlet/pull/12) [`b596252`](https://github.com/pacaplan/agent-gauntlet/commit/b596252c66ef675c75fcdcc426e17bd01fcdcf7f) Thanks [@pacaplan](https://github.com/pacaplan)! - ### New Features

  - Add LogTape logger for structured logging with stop-hook support
  - Adopt Changesets for automated release workflow and changelog generation
  - Extend stop-hook configuration with `enabled` flag and environment variable overrides

  ### Improvements

  - Simplify stop-hook by delegating interval check to executor
  - Add status icons and systemMessage to stop-hook output
  - Expose `intervalMinutes` in stop-hook configuration
