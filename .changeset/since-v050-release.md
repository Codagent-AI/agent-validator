---
"agent-gauntlet": minor
---

### Features

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
