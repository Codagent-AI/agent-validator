## 0. Pre-factoring
No hotspots modified. Code Health scores for affected files:
- `src/config/schema.ts`: 10.0
- `src/gates/check.ts`: 9.25
- `src/core/runner.ts`: 8.35
- `src/commands/check.ts`: 8.59
- `src/core/run-executor.ts`: 8.6
- `src/commands/review.ts`: 8.59

All scores > 8.0; no pre-factoring needed.

## 1. Implementation
- [ ] 1.1 Add `rerun_command: z.string().optional()` to `checkGateSchema` in `src/config/schema.ts`
- [ ] 1.2 Add `isRerun` parameter to `CheckGateExecutor.execute()` in `src/gates/check.ts`; when `isRerun && config.rerun_command`, use `rerun_command` with same `substituteVariables()` call
- [ ] 1.3 Add `isRerun` parameter to `Runner` constructor in `src/core/runner.ts`; pass it through to `checkExecutor.execute()`. Note: `previousFailuresMap` is review-specific and may be empty in check-only rerun mode, so an explicit `isRerun` boolean is needed.
- [ ] 1.4 Pass `isRerun` when constructing `Runner` in `src/commands/check.ts` (already computed as local variable)
- [ ] 1.5 Pass `isRerun` when constructing `Runner` in `src/core/run-executor.ts` (already computed as local variable)
- [ ] 1.6 Pass `isRerun` when constructing `Runner` in `src/commands/review.ts` (already computed as local variable)
- [ ] 1.7 Add `rerun_command: cs delta ${BASE_BRANCH}` to `.gauntlet/checks/code-health.yml`
- [ ] 1.8 Add `rerun_command` to the check gate fields table in `docs/config-reference.md`
- [ ] 1.9 Add `rerun_command` to the check gate fields list in `docs/user-guide.md`

## 2. Tests
- [ ] 2.1 Unit test: `CheckGateExecutor` uses `rerun_command` when `isRerun=true` and `rerun_command` is defined
- [ ] 2.2 Unit test: `CheckGateExecutor` falls back to `command` when `isRerun=true` but `rerun_command` is not defined
- [ ] 2.3 Unit test: `CheckGateExecutor` uses `command` when `isRerun=false` even if `rerun_command` is defined
- [ ] 2.4 Unit test: variable substitution is applied to `rerun_command` (e.g., `${BASE_BRANCH}` is replaced)
- [ ] 2.5 Schema test: `checkGateSchema` accepts config with `rerun_command`
- [ ] 2.6 Schema test: `checkGateSchema` accepts config without `rerun_command`

## 3. Validation

There are no automated validation tasks that need to be explicitly run. When work is completed, a stop hook should execute the full gauntlet of verification tasks and give direction on what needs to be fixed.
