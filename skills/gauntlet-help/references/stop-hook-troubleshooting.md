# Stop Hook Troubleshooting

## All Stop-Hook Statuses

### Allowing Statuses (stop is permitted)

| Status | Message | Meaning |
|--------|---------|---------|
| `passed` | All gates completed successfully | Every configured check and review gate passed |
| `passed_with_warnings` | Passed with warnings (some issues were skipped) | Gates ran but some review violations were skipped rather than fixed |
| `no_applicable_gates` | No applicable gates matched current changes | Changed files didn't match any configured entry point |
| `no_changes` | No changes detected | No files changed relative to `base_branch` |
| `no_config` | Not a gauntlet project — no `.gauntlet/config.yml` found | No gauntlet configuration in this repo |
| `stop_hook_active` | Stop hook cycle detected — allowing stop to prevent infinite loop | Recursion prevention triggered |
| `stop_hook_disabled` | *(silent — no message displayed)* | `stop_hook.enabled: false` in config or `GAUNTLET_STOP_HOOK_ENABLED=false` |
| `interval_not_elapsed` | Run interval not elapsed | `stop_hook.run_interval_minutes` hasn't elapsed since last run |
| `invalid_input` | Invalid hook input — could not parse JSON | Stop-hook couldn't parse stdin JSON from the IDE |
| `lock_conflict` | Another gauntlet run is already in progress | Lock file exists with a live PID |
| `error` | Stop hook error | Unexpected error during execution |
| `retry_limit_exceeded` | Retry limit exceeded | Max retries (default 3) exhausted; requires `agent-gauntlet clean` |

### Blocking Statuses (stop is prevented)

| Status | Message | Meaning |
|--------|---------|---------|
| `failed` | Issues must be fixed before stopping | One or more gates failed; agent must fix and re-run |

## Common Scenarios

### "The hook blocked my stop"
1. Check the status in `.debug.log` — search for `status:` entries
2. If `failed`: Read the gate output files listed in `.debug.log` or the latest `console.*.log`

### "The hook allowed but shouldn't have"
1. Check if the status was `no_changes` — verify `base_branch` is correct in `config.yml`
2. Check if `no_applicable_gates` — run `agent-gauntlet detect` to see which files changed and which gates match
3. Check if `interval_not_elapsed` — the run was skipped because `run_interval_minutes` hadn't elapsed
4. Check if `stop_hook_disabled` — verify `stop_hook.enabled` in config and `GAUNTLET_STOP_HOOK_ENABLED` env var

### "The gauntlet isn't running gates / keeps allowing stops immediately"
This happens when the iteration counter is inherited from a previous session's failures. Symptoms:
1. `.debug.log` shows `RUN_START` followed immediately by `RUN_END` with `duration=0.0s`
2. `iterations` value is high (e.g., 7, 8, 9) even though the current session hasn't run that many times
3. Stop-hook returns `retry_limit_exceeded` without executing any gates
4. `failed=0` in `RUN_END` (no gates ran, so none failed — but status is still `fail`)

**Root cause**: The iteration counter persists in `.execution_state` across sessions. If a previous session ended with unresolved failures and hit the retry limit, the counter carries over. The next session enters verification mode and immediately exceeds the limit.

**Fix**: Run `agent-gauntlet clean` to reset the state and iteration counter, then re-run.

**Prevention**: Before starting a new task, check if the previous session left failures behind. If `.debug.log` shows a recent `STOP_HOOK decision=block reason=failed` or `retry_limit_exceeded`, clean state first.

### "The hook seems stuck"
1. Check for `.stop-hook-active` marker in `<log_dir>/` — if present, a stop-hook may be running
2. Check PID in the marker file — is that process alive?
3. The stop-hook has a **5-minute hard timeout** (`STOP_HOOK_TIMEOUT_MS`) and will self-terminate
4. Stale marker files older than **10 minutes** are automatically cleaned up on next invocation

## Recursion Prevention

The stop-hook uses three layers to prevent infinite loops:

### Layer 1: Environment Variable
- Variable: `GAUNTLET_STOP_HOOK_ACTIVE`
- Set by the parent gauntlet when spawning child CLI processes for reviews
- If `GAUNTLET_STOP_HOOK_ACTIVE=1`, the stop-hook exits immediately with `stop_hook_active`
- Prevents child review processes from triggering nested gauntlets

### Layer 2: Marker File
- File: `<log_dir>/.stop-hook-active` (contains the PID)
- Created before execution, removed after completion (in `finally` block)
- If another stop-hook fires during execution and finds a fresh marker (< 10 min old), it exits with `stop_hook_active`
- Stale markers (> 10 min) are deleted and execution proceeds
- Needed because Claude Code does NOT pass env vars to hooks

### Layer 3: IDE Input Field
- Claude Code: `stop_hook_active` boolean in the stdin JSON
- Cursor: `loop_count` field; threshold is 10 (returns `retry_limit_exceeded` if exceeded)
- Additional safety net from the IDE itself

## Timing Values

| Timer | Value | Purpose |
|-------|-------|---------|
| Stdin timeout | 5 seconds | Safety net for delayed stdin from IDE |
| Hard timeout | 5 minutes | Self-timeout to prevent zombie processes |
| Stale marker | 10 minutes | Marker files older than this are cleaned up |
| `run_interval_minutes` | Configurable (default 0 = always run) | Minimum time between stop-hook runs |

## Environment Variable Overrides

These override project config values (env > project config > global config):

| Variable | Type | Effect |
|----------|------|--------|
| `GAUNTLET_STOP_HOOK_ENABLED` | `true`/`1`/`false`/`0` | Enable or disable the stop hook entirely |
| `GAUNTLET_STOP_HOOK_INTERVAL_MINUTES` | Integer >= 0 | Minutes between runs (0 = always run) |

## Diagnosing `stop_hook_disabled`

This status means the stop hook has been explicitly disabled. Check in order:

1. `GAUNTLET_STOP_HOOK_ENABLED` environment variable (highest precedence)
2. `.gauntlet/config.yml` → `stop_hook.enabled`
3. `~/.config/agent-gauntlet/config.yml` → `stop_hook.enabled` (global)

To re-enable: remove the env var or set `stop_hook.enabled: true` in config.
