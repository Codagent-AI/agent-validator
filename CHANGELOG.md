# agent-gauntlet

## 1.2.0

### Minor Changes

- [#95](https://github.com/pacaplan/agent-gauntlet/pull/95) Add `review-audit` command that aggregates AI review results across tabs with a cross-tab breakdown for easier analysis

### Patch Changes

- [#96](https://github.com/pacaplan/agent-gauntlet/pull/96) Fix skill installation in the `init` command by dynamically discovering skills from the `skills/` directory instead of using a hardcoded list

## 1.1.0

### Minor Changes

- [#91](https://github.com/pacaplan/agent-gauntlet/pull/91) Add per-review `enabled` flag and `--enable-review` CLI override to selectively activate individual reviews without modifying config files

- [#92](https://github.com/pacaplan/agent-gauntlet/pull/92) Add `skill-quality` reviewer that evaluates skill prompt adherence, and fix stale base branch detection to prevent false diff scope misses

- [#93](https://github.com/pacaplan/agent-gauntlet/pull/93) Add `gauntlet-commit`, `gauntlet-merge`, and `gauntlet-issue` skills for streamlined commit, merge, and issue management workflows

### Patch Changes

- [#88](https://github.com/pacaplan/agent-gauntlet/pull/88) Remove trust level configuration, redesign failure output for better readability, and clean up obsolete code

- [#90](https://github.com/pacaplan/agent-gauntlet/pull/90) Fix stash `^3` parent check to correctly detect untracked files when scoping diffs for rerun commands

## 1.0.0

### Major Changes

- [#86](https://github.com/pacaplan/agent-gauntlet/pull/86) Remove the `gauntlet-fix-pr`, `gauntlet-push-pr`, and `wait-ci` commands, streamlining the CLI to focus on core verification functionality

### Minor Changes

- [#83](https://github.com/pacaplan/agent-gauntlet/pull/83) Add `agent-gauntlet skip` command for bypassing specific gates, and upgrade bundled openspec skills to the latest versions

### Patch Changes

- [#84](https://github.com/pacaplan/agent-gauntlet/pull/84) Ensure the stdout Status line is written on all exit paths and remove `2>&1` redirections that were mixing stderr into stdout

- [#85](https://github.com/pacaplan/agent-gauntlet/pull/85) Revert ConsoleReporter output back to stderr and fix a process exit hang caused by pending stdout writes

## 0.15.5

### Patch Changes

- [#81](https://github.com/pacaplan/agent-gauntlet/pull/81) Move all ConsoleReporter output from stderr to stdout so agents can see gate results when running `agent-gauntlet` via Bash tool

## 0.15.4

### Patch Changes

- [#78](https://github.com/pacaplan/agent-gauntlet/pull/78) Prevent verification mode from reporting false positives by fixing how pass/fail status is determined during verification runs

- [#79](https://github.com/pacaplan/agent-gauntlet/pull/79) Prevent event-loop blocking in review output evaluation by avoiding synchronous processing of large review results

## 0.15.3

### Patch Changes

- [#75](https://github.com/pacaplan/agent-gauntlet/pull/75) Replace CodeScene integration with Biome's built-in clean code lint rules for complexity and style analysis

- [#76](https://github.com/pacaplan/agent-gauntlet/pull/76) Replace OTel regex-based cost extraction with an O(n) line-based scanner for improved performance and reliability

## 0.15.2

### Patch Changes

- [#73](https://github.com/pacaplan/agent-gauntlet/pull/73) Add E2E integration tests for the `gauntlet-setup` skill and refactor the stop-hook E2E test to use `bun:test` format for consistency

## 0.15.1

### Patch Changes

- [#70](https://github.com/pacaplan/agent-gauntlet/pull/70) Move skills from generated template strings to static distributable source files under `skills/`, simplifying maintenance and enabling direct file distribution

- [#71](https://github.com/pacaplan/agent-gauntlet/pull/71) Exclude `CLAUDECODE` env var from child processes to prevent the nesting guard from blocking stop-hook execution in Claude Code's latest channel

## 0.15.0

### Minor Changes

- [#64](https://github.com/pacaplan/agent-gauntlet/pull/64) Refactor `gauntlet-run` to delegate log and JSON file processing to disposable haiku subagents, keeping the main agent's context window free of ephemeral detail

- [#65](https://github.com/pacaplan/agent-gauntlet/pull/65) Add `agent-gauntlet status` CLI command, 3-tier subagent fallback strategy with Cursor `--trust` flag support, and prescriptive skill prompt improvements

- [#66](https://github.com/pacaplan/agent-gauntlet/pull/66) Add `capture-eval-issues` skill that uses a sonnet subagent to judge review violations and capture noteworthy ones into `evals/inventory.yml` for the eval framework

- [#67](https://github.com/pacaplan/agent-gauntlet/pull/67) Add per-adapter model resolution that automatically selects the highest-versioned CLI model matching a configured base name, with support for Cursor and Copilot adapters

- [#68](https://github.com/pacaplan/agent-gauntlet/pull/68) Update built-in `code-quality` review prompt to conditionally dispatch pr-review-toolkit agents (`code-reviewer`, `silent-failure-hunter`, `type-design-analyzer`) with inline fallback when agents are unavailable

## 0.14.0

### Minor Changes

- [#60](https://github.com/pacaplan/agent-gauntlet/pull/60) Add gauntlet auto-invocation via skill frontmatter and start hooks, enabling automatic quality verification when coding tasks are detected

- [#62](https://github.com/pacaplan/agent-gauntlet/pull/62) Redesign `init` command with interactive CLI selection, reviewer setup, and checksum-based change detection for idempotent re-runs

### Patch Changes

- [#61](https://github.com/pacaplan/agent-gauntlet/pull/61) Remove openspec `tasks.md` and simplify the proposal workflow to reduce overhead

## 0.13.1

### Patch Changes

- [#58](https://github.com/pacaplan/agent-gauntlet/pull/58) Detect the default git branch dynamically instead of hard-coding `origin/main`, enabling correct behavior in repos that use `master` or other default branch names

## 0.13.0

### Minor Changes

- [#55](https://github.com/pacaplan/agent-gauntlet/pull/55) Improve `gauntlet init` command UX with better defaults, streamlined prompts, and a more intuitive setup flow

### Patch Changes

- [#56](https://github.com/pacaplan/agent-gauntlet/pull/56) Add time-window based loop detection for the stop hook, preventing repeated stop-hook triggers within a configurable time window

## 0.12.0

### Minor Changes

- [#52](https://github.com/pacaplan/agent-gauntlet/pull/52) Simplify `gauntlet init` to a lightweight scaffolding step and introduce a `/gauntlet-setup` skill that guides users through full project configuration interactively

### Patch Changes

- [#53](https://github.com/pacaplan/agent-gauntlet/pull/53) Skip automatic branch cleanup after commit-merged when uncommitted changes exist, preventing accidental loss of in-progress work

## 0.11.0

### Minor Changes

- [#50](https://github.com/pacaplan/agent-gauntlet/pull/50) Remove Bun runtime requirement for end users — ship compiled JS to npm so `npm install -g agent-gauntlet` works with just Node.js (>=18), replacing Bun's Glob with picomatch and adding a Bun.build()-based build pipeline

## 0.10.1

### Patch Changes

- [#47](https://github.com/pacaplan/agent-gauntlet/pull/47) Add stop-hook E2E integration test exercising the full lifecycle, generate adapter config during `gauntlet init` based on eval results, and update README documentation

## 0.10.0

### Minor Changes

- [#32](https://github.com/pacaplan/agent-gauntlet/pull/32) Add `rerun_command` field to check gates, allowing reviewers to specify a command for re-running failed checks

- [#33](https://github.com/pacaplan/agent-gauntlet/pull/33) Add OpenTelemetry telemetry for Claude and Gemini CLI adapters with span-based tracing of adapter runs

- [#35](https://github.com/pacaplan/agent-gauntlet/pull/35) Refactor built-in reviews from hardcoded logic to YAML configuration files with pure markdown prompt templates

- [#36](https://github.com/pacaplan/agent-gauntlet/pull/36) Add adapter telemetry instrumentation with debug log persistence for post-run diagnostics

- [#37](https://github.com/pacaplan/agent-gauntlet/pull/37) Add per-adapter configuration for tool use permissions and thinking budget allocation

- [#38](https://github.com/pacaplan/agent-gauntlet/pull/38) Add `gauntlet-check` and `gauntlet-status` skills for querying gauntlet run state from within adapters

- [#40](https://github.com/pacaplan/agent-gauntlet/pull/40) Add eval framework for measuring adapter performance across structured test scenarios

- [#41](https://github.com/pacaplan/agent-gauntlet/pull/41) Add help skill providing contextual usage guidance for gauntlet commands and configuration

- [#43](https://github.com/pacaplan/agent-gauntlet/pull/43) Add configurable N-deep log rotation with automatic cleanup when the retry limit is reached

### Patch Changes

- [#31](https://github.com/pacaplan/agent-gauntlet/pull/31) Fix auto-clean triggering on stale state and resolve post-gauntlet PR creation and CI workflow bugs

- [#34](https://github.com/pacaplan/agent-gauntlet/pull/34) Add per-reviewer GATE_RESULT logging and track execution state changes for debugging review pipelines

- [#39](https://github.com/pacaplan/agent-gauntlet/pull/39) Fix TypeScript compilation errors across adapter and reviewer modules

- [#42](https://github.com/pacaplan/agent-gauntlet/pull/42) Remove redundant comment on `buildHelpSkillBundle` function

- [#44](https://github.com/pacaplan/agent-gauntlet/pull/44) Add superpowers skill bundle for enhanced development workflows

- [#45](https://github.com/pacaplan/agent-gauntlet/pull/45) Add Gemini adapter to the eval test suite

## 0.9.0

### Minor Changes

- [#29](https://github.com/pacaplan/agent-gauntlet/pull/29) Implement auto-fix-pr feature for autonomous CI monitoring and fix wait-ci API response parsing

- [#25](https://github.com/pacaplan/agent-gauntlet/pull/25) Implement auto_push_pr stop hook workflow

- Add cursor stop hook for detecting and handling cursor adapter stops

- [#30](https://github.com/pacaplan/agent-gauntlet/pull/30) Prevent clean command from running during active gauntlet run, properly skip unhealthy adapters, and include GitHub Actions failure logs in CI fix instructions

### Patch Changes

- [#27](https://github.com/pacaplan/agent-gauntlet/pull/27) Include stderr in adapter error messages for usage limit detection and prevent stale execution state from causing false auto-clean and phantom diffs

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
