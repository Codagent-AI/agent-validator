## 0. Pre-factoring

CodeScene hotspot analysis for files modified by this change:
- `src/utils/execution-state.ts` — Code Health 9.38 (Green)
- `src/gates/review.ts` — Code Health 7.2 (Yellow)

Refactoring tasks (hotspot candidate):
- [ ] 0.1 Refactor `ReviewGateExecutor.getDiff` in `src/gates/review.ts` (Bumpy Road, Complex Method, Large Method)

## 1. Implementation
- [ ] 1.1 Add global unhealthy adapter state path resolver with env override (e.g. `GAUNTLET_GLOBAL_STATE_DIR`) inside `src/utils/unhealthy-adapters.ts` (use `path.dirname(getGlobalConfigPath())` for the default dir).
- [ ] 1.2 Create `src/utils/unhealthy-adapters.ts` to read/write global unhealthy adapter state.
- [ ] 1.3 Remove unhealthy adapter persistence from `src/utils/execution-state.ts`; keep only run metadata.
- [ ] 1.4 Update review gate to use the new unhealthy adapter utility (read/mark/clear).
- [ ] 1.5 Ensure `clean` does not clear global unhealthy adapter state (no-op change or explicit guard).
- [ ] 1.6 Update docs to describe the new global storage location and behavior.

## 2. Tests
- [ ] 2.1 Add unit tests for global unhealthy adapter persistence with env override.
- [ ] 2.2 Add tests for global state file missing/invalid (treat all adapters healthy).
- [ ] 2.3 Add tests for clean not clearing global unhealthy adapter state.
- [ ] 2.4 Add tests for usage limit detected in output (marks adapter unhealthy).
- [ ] 2.5 Add tests for usage limit detected in exception (marks adapter unhealthy).
- [ ] 2.6 Add tests for non-usage-limit errors (does not mark adapter unhealthy).
- [ ] 2.7 Add tests for cooldown skip (adapter within cooldown skipped).
- [ ] 2.8 Add tests for cooldown expired + binary available (clears unhealthy flag).
- [ ] 2.9 Add tests for cooldown expired + binary missing (remains unhealthy).
- [ ] 2.10 Add tests for all adapters cooling down (gate errors).
- [ ] 2.11 Update review gate tests to use global unhealthy adapter state utility.

## 3. Validation
There are no validation tasks that need to be explicitly run. When work is completed, a stop hook should execute the full gauntlet of verification tasks and give direction on what needs to be fixed.

If there is a "Manual Verification" section above, complete all verification steps before marking the task complete.
