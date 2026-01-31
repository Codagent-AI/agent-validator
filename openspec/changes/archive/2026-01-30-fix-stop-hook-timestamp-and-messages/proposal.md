# Proposal: Fix Stop Hook Timestamp Updates and User Messages

## Problem Statement

Two critical issues with the stop-hook:

### Issue 1: Incorrect Timestamp Updates Block Future Runs

The `writeExecutionState()` function is called for statuses where no actual gauntlet work was performed. This updates `last_run_completed_at`, causing subsequent stop-hook invocations to skip the gauntlet due to `interval_not_elapsed` — even though no gauntlet ever actually ran.

**Current behavior:** Timestamp is updated for:
- `no_changes` — No work done, but timestamp updated
- `no_applicable_gates` — No work done, but timestamp updated
- `error` — System failure, but timestamp updated
- `passed`, `passed_with_warnings`, `failed`, `retry_limit_exceeded` — Work done, timestamp updated (correct)

**Impact:** If an agent makes commits after hitting `no_changes`, subsequent stop-hook calls will skip the gauntlet (due to interval) until the interval expires, even though actual changes now exist that should be validated.

### Issue 2: Status Messages Only Displayed on Failures

The stop-hook only returns a `reason` (displayed to user) when blocking. For non-blocking statuses like `interval_not_elapsed`, `no_config`, `lock_conflict`, etc., the human-friendly message is not shown to the user in Claude Code.

**Current behavior:** The `message` field exists in the response but only `reason` is displayed by Claude Code (and only when blocking).

**Impact:** Users have no visibility into why the gauntlet was skipped, making it difficult to understand system behavior.

## Solution

### Fix 1: Only Update Timestamp When Gates Execute

Update `writeExecutionState()` call sites to only execute for statuses indicating actual gate execution:

| Status | Update Timestamp? | Rationale |
|--------|-------------------|-----------|
| `passed` | ✓ | Gates ran and passed |
| `passed_with_warnings` | ✓ | Gates ran, some issues skipped |
| `failed` | ✓ | Gates ran and failed |
| `retry_limit_exceeded` | ✓ | Gates ran, hit retry limit |
| `no_changes` | ✗ | Early exit, no gates ran |
| `no_applicable_gates` | ✗ | Early exit, no gates ran |
| `error` | ✗ | System failure, no gates completed |
| `lock_conflict` | ✗ | Another run in progress |

### Fix 2: Always Display Human-Friendly Messages

Use the `stopReason` field for all statuses (not just blocking ones) to ensure users see feedback in Claude Code.

**Field usage in Claude Code hook protocol:**
- `stopReason` — Always displayed to the user (regardless of decision)
- `reason` — Used when `decision: "block"` to feed instructions back to Claude
- `message` — Internal field for structured logging

The existing `getStatusMessage()` function already provides appropriate messages for each status — we just need to include them as `stopReason` in all responses.

## Impact

- **Affected specs:** `stop-hook` (modifies "Execution State Tracking" requirement, adds "Stop Hook Status Messages" requirement)
- **Affected code:** `src/core/run-executor.ts` (`writeExecutionState()` call sites), `src/commands/stop-hook.ts` (`outputHookResponse()`)
- **Breaking changes:** None — this is a behavioral fix, not an API change
- **Note:** The new "Stop Hook Status Messages" requirement extends message display to non-blocking statuses; the existing "Enhanced Stop Reason Instructions" requirement remains unchanged for blocking failure scenarios.

## Scope

- **In scope:** `run-executor.ts` timestamp logic, `stop-hook.ts` response formatting
- **Out of scope:** Changes to the execution state file format, changes to global config

## References

- `src/core/run-executor.ts:307,331,372,408` — `writeExecutionState()` call sites
- `src/commands/stop-hook.ts` — `outputHookResponse()` and `getStatusMessage()`
- `src/types/gauntlet-status.ts` — `GauntletStatus` type definition
