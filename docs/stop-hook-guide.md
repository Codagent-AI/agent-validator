# Stop Hook Guide

The stop hook integrates Agent Gauntlet with Claude Code, automatically validating that all gates pass before an AI agent can stop working on a task.

## Overview

When an AI agent using Claude Code attempts to stop (e.g., by saying "I'm done"), the stop hook:
1. Runs `agent-gauntlet run` to check all configured gates
2. If gates pass, allows the agent to stop
3. If gates fail, blocks the stop and directs the agent to fix the issues

The hook automatically re-runs after each fix attempt, creating a feedback loop until all issues are resolved.

## Installation

### Prerequisites

- Agent Gauntlet installed globally (`bun add -g agent-gauntlet`)
- A project with `.gauntlet/config.yml` initialized (`agent-gauntlet init`)
- Claude Code CLI installed and configured

### Claude Code Configuration

Add the stop hook to your Claude Code settings:

**Option 1: Project-level settings** (`.claude/settings.json`):
```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": ["agent-gauntlet stop-hook"]
      }
    ]
  }
}
```

**Option 2: Global settings** (via `claude settings`):
```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": ["agent-gauntlet stop-hook"]
      }
    ]
  }
}
```

The empty `matcher` means the hook runs for all projects. Use a path pattern like `"/path/to/project/*"` to limit to specific projects.

## Configuration

Stop hook behavior can be configured at three levels with clear precedence:
1. **Environment variables** (highest priority)
2. **Project config** (`.gauntlet/config.yml`)
3. **Global config** (`~/.config/agent-gauntlet/config.yml`) (lowest priority)

### Global Configuration

User-level settings are stored in `~/.config/agent-gauntlet/config.yml`:

```yaml
stop_hook:
  enabled: true               # Whether stop hook is active (default: true)
  run_interval_minutes: 10    # Minimum time between gauntlet runs
```

### Project Configuration

Override global settings per-project in `.gauntlet/config.yml`:

```yaml
stop_hook:
  enabled: true               # Override global enabled setting
  run_interval_minutes: 5     # Override global interval
```

### Environment Variable Overrides

Override all config levels using environment variables:

| Variable | Values | Description |
|----------|--------|-------------|
| `GAUNTLET_STOP_HOOK_ENABLED` | `true`, `1`, `false`, `0` | Override whether stop hook is enabled |
| `GAUNTLET_STOP_HOOK_INTERVAL_MINUTES` | Non-negative integer | Override run interval (0 = always run) |

Example:
```bash
# Disable stop hook for this session
GAUNTLET_STOP_HOOK_ENABLED=false claude
```

### Configuration Options

| Setting | Default | Description |
|---------|---------|-------------|
| `stop_hook.enabled` | `true` | Whether stop hook validation runs. Set to `false` to disable entirely. |
| `stop_hook.run_interval_minutes` | `10` | Minimum minutes between gauntlet runs. Set to `0` to always run. Prevents excessive re-runs during active development. |

## How It Works

### Decision Flow

1. **No gauntlet project**: If no `.gauntlet/config.yml` exists, the hook allows the stop immediately.

2. **Stop hook disabled**: If `enabled: false` is set via environment variable, project config, or global config, the hook allows the stop immediately.

3. **Already running**: If another gauntlet is in progress (lock file exists), the hook allows the stop to prevent deadlocks.

4. **Interval not elapsed**: If less than `run_interval_minutes` since the last run (and interval > 0), the hook allows the stop without re-running gates.

5. **Gates pass**: If `agent-gauntlet run` succeeds, the hook allows the stop.

6. **Gates fail**: The hook blocks the stop and returns instructions to the agent for fixing issues.

### Termination Conditions

The agent can stop when any of these conditions are met:

- **"Status: Passed"** — All gates passed successfully
- **"Status: Passed with warnings"** — Some issues were skipped (marked as `status: "skipped"`)
- **"Status: Retry limit exceeded"** — Too many fix attempts; requires `agent-gauntlet clean` to archive and reset

## Viewing Hook Output

### Verbose Mode

Claude Code hooks write diagnostic output to stderr. To see this output:

1. Run Claude Code with verbose hook output enabled
2. Look for lines prefixed with `[gauntlet]`

Example output:
```
[gauntlet] Starting gauntlet validation...
[gauntlet] Running gauntlet gates...
[gauntlet] Gauntlet failed, blocking stop
```

### Failed Gate Log Files

When the stop hook blocks, it includes paths to the specific failed gate log files in its response:
- **Check failures**: `.log` files containing the check command output
- **Review failures**: `.json` files containing review violations to address

To manually inspect logs:
```bash
# List all gate log files
ls gauntlet_logs/
```

## Troubleshooting with Debug Logs

Debug logging provides detailed information about stop-hook decisions and gauntlet execution. Enable it to understand why a stop was allowed or blocked.

### Enabling Debug Logging

Add to your `.gauntlet/config.yml`:
```yaml
debug_log:
  enabled: true
  max_size_mb: 10
```

Or configure globally in `~/.config/agent-gauntlet/config.yml`:
```yaml
debug_log:
  enabled: true
  max_size_mb: 10
```

### Debug Log Location

Debug logs are written to `{log_dir}/.debug.log`. View with:
```bash
cat gauntlet_logs/.debug.log
```

### STOP_HOOK Log Entry Format

Each stop-hook decision is logged with:
```
[timestamp] STOP_HOOK decision=<allow|block> reason=<GauntletStatus>
```

Example entries:
```
[2026-01-26T10:00:00Z] STOP_HOOK decision=allow reason=passed
[2026-01-26T10:01:00Z] STOP_HOOK decision=block reason=failed
[2026-01-26T10:02:00Z] STOP_HOOK decision=allow reason=interval_not_elapsed
```

### GauntletStatus Values

| Status | Decision | Description |
|--------|----------|-------------|
| `passed` | allow | All gates passed successfully |
| `passed_with_warnings` | allow | Passed with some skipped issues |
| `no_applicable_gates` | allow | No gates matched the changes |
| `no_changes` | allow | No file changes detected |
| `failed` | block | One or more gates failed |
| `retry_limit_exceeded` | allow | Too many fix attempts; clean needed |
| `lock_conflict` | allow | Another gauntlet is running |
| `error` | allow | Unexpected error occurred |
| `no_config` | allow | No `.gauntlet/config.yml` found |
| `stop_hook_active` | allow | Recursive hook prevention triggered |
| `interval_not_elapsed` | allow | Run interval not yet passed |
| `invalid_input` | allow | Invalid input to stop-hook |
| `stop_hook_disabled` | allow | Stop hook disabled via configuration |

### RUN_START with Diff Statistics

When debug logging is enabled, run starts include diff statistics:
```
[timestamp] RUN_START mode=full base_ref=origin/main files_changed=5 files_new=2 files_modified=2 files_deleted=1 lines_added=150 lines_removed=30 gates=2
```

Fields:
- `mode`: "full" for initial run, "verification" for re-run
- `base_ref`: Reference used for diff (branch, commit SHA, "uncommitted")
- `files_changed`: Total files affected
- `files_new`/`files_modified`/`files_deleted`: File change breakdown
- `lines_added`/`lines_removed`: Line change counts
- `gates`: Number of gates to run

### Example Debug Session

```
[2026-01-26T10:00:00Z] COMMAND stop-hook
[2026-01-26T10:00:01Z] RUN_START mode=full base_ref=origin/main files_changed=3 files_new=1 files_modified=2 files_deleted=0 lines_added=50 lines_removed=10 gates=2
[2026-01-26T10:00:05Z] GATE_RESULT check:src:lint status=pass duration=1.50s violations=0
[2026-01-26T10:00:10Z] GATE_RESULT review:src:quality status=fail duration=3.20s violations=2
[2026-01-26T10:00:10Z] RUN_END status=fail fixed=0 skipped=0 failed=2 iterations=1
[2026-01-26T10:00:10Z] STOP_HOOK decision=block reason=failed
```

## Troubleshooting

### Hook Not Running

**Symptoms**: Agent stops without gauntlet validation.

**Checks**:
1. Verify hook is configured in Claude Code settings
2. Confirm `.gauntlet/config.yml` exists in the project
3. Check if the matcher pattern includes your project path

### Hook Keeps Blocking

**Symptoms**: Agent can't stop even after fixing issues.

**Checks**:
1. Read the failed gate log files listed in the stop reason
2. Look for remaining gate failures in the log output
3. For review violations, ensure all issues have `"status": "fixed"` or `"status": "skipped"` in the JSON files
4. If stuck, run `agent-gauntlet clean` to archive the session and start fresh

### Gauntlet Timeout

**Symptoms**: Hook blocks with a timeout message.

**Checks**:
1. The gauntlet has a 5-minute timeout to match Claude Code's hook timeout
2. If gates consistently time out, check for slow checks or hanging processes
3. Consider increasing parallelism via `allow_parallel: true` in config

### "Gauntlet already running" Message

**Symptoms**: Hook allows stop with this message.

**Explanation**: Another gauntlet process holds the lock file. This is normal if you triggered a manual run while the hook was checking.

**Resolution**: Wait for the other process to complete, or check for orphaned lock files:
```bash
# View lock file
cat gauntlet_logs/.gauntlet-run.lock

# If orphaned, remove it (only if you're sure no gauntlet is running)
rm gauntlet_logs/.gauntlet-run.lock
```

### Infinite Loop Prevention

The hook has built-in infinite loop prevention. If `stop_hook_active: true` is set in the hook input, it allows the stop immediately. This prevents scenarios where the hook repeatedly blocks itself.

## Best Practices

1. **Set appropriate run interval**: If your gauntlet takes a long time, increase `run_interval_minutes` to avoid excessive re-runs.

2. **Use verification mode**: The gauntlet automatically uses verification mode (only re-runs failed gates) when logs exist, speeding up fix iterations.

3. **Handle skipped issues**: Use `"status": "skipped"` with a reason for issues you intentionally don't fix. This allows the gauntlet to pass with warnings.

4. **Clean between branches**: Run `agent-gauntlet clean` when switching branches to avoid confusion from stale logs.

## Related Documentation

- [Quick Start](quick-start.md) — initial setup
- [Configuration Reference](config-reference.md) — all configuration options
- [User Guide](user-guide.md) — detailed usage information
