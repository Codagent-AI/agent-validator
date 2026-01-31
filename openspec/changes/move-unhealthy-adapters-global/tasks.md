## 0. Pre-factoring
CodeScene not available — hotspot analysis skipped.

## 1. Implementation
- [ ] 1.1 Add global unhealthy adapter state path resolver with env override (e.g. `GAUNTLET_GLOBAL_STATE_DIR`).
- [ ] 1.2 Create `src/utils/unhealthy-adapters.ts` to read/write global unhealthy adapter state.
- [ ] 1.3 Remove unhealthy adapter persistence from `src/utils/execution-state.ts`; keep only run metadata.
- [ ] 1.4 Update review gate to use the new unhealthy adapter utility (read/mark/clear).
- [ ] 1.5 Ensure `clean` does not clear global unhealthy adapter state (no-op change or explicit guard).
- [ ] 1.6 Update docs to describe the new global storage location and behavior.

## 2. Tests
- [ ] 2.1 Add unit tests for global unhealthy adapter persistence with env override.
- [ ] 2.2 Update review gate tests to use global unhealthy adapter state.
- [ ] 2.3 Add test coverage for cooldown skip and recovery using the new utility.

## 3. Validation
There are no validation tasks that need to be explicitly run. When work is completed, a stop hook should execute the full gauntlet of verification tasks and give direction on what needs to be fixed.

If there is a "Manual Verification" section above, complete all verification steps before marking the task complete.
