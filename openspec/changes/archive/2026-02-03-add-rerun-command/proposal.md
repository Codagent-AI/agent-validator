# Change: Add `rerun_command` field to check gates

## Why
The code-health check uses `--error-on-warnings` on first run so the agent sees warnings as failures, but on reruns this causes warnings to keep failing even when the agent has fixed the original issues. A separate `rerun_command` allows checks to use a different command on reruns.

## Alternatives Considered

1. **Remove `--error-on-warnings` entirely**: Simplest option, but loses the benefit of surfacing warnings as failures on first run. The agent wouldn't know about warnings until they accumulate.

2. **Caller-side command mutation (strip flags on rerun)**: Each caller (check.ts, run-executor.ts, review.ts) already computes `isRerun` and could mutate the check config's command before passing it to Runner. However, this spreads command-selection logic across 3 callers and requires mutating config objects, which is fragile.

3. **`rerun_command` field (chosen)**: A declarative config field keeps the rerun behavior co-located with the check definition. The `isRerun` boolean is threaded from callers (which already compute it) through Runner to CheckGateExecutor — a single additional parameter at each layer. This is consistent with how other rerun-specific behavior flows through the system.

## What Changes
- Add optional `rerun_command` field to `checkGateSchema` (Zod schema)
- `LoadedCheckGateConfig` inherits the new field automatically via `z.infer`
- `CheckGateExecutor.execute()` accepts an `isRerun` flag; when true and `rerun_command` is defined, it uses that command instead of `command`
- `Runner` accepts `isRerun` in constructor and forwards it to check executor. Note: while `previousFailuresMap` being non-empty implies rerun mode, that map is specific to review gates and may be empty even in rerun mode when only check gates exist. An explicit `isRerun` avoids coupling check gate behavior to review-specific data structures.
- All Runner call sites (`check.ts`, `run-executor.ts`, `review.ts`) pass their existing `isRerun` local variable
- `.gauntlet/checks/code-health.yml` adds `rerun_command` without `--error-on-warnings`
- Documentation updated in `docs/config-reference.md` and `docs/user-guide.md`

## Impact
- Affected specs: `check-config`
- Affected code: `src/config/schema.ts`, `src/gates/check.ts`, `src/core/runner.ts`, `src/commands/check.ts`, `src/core/run-executor.ts`, `src/commands/review.ts`, `.gauntlet/checks/code-health.yml`, `docs/config-reference.md`, `docs/user-guide.md`
