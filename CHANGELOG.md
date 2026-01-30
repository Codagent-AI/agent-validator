# agent-gauntlet

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
