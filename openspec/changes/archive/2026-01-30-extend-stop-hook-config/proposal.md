# Proposal: extend-stop-hook-config

## Summary

Extend the stop hook interval configuration to support three configuration sources with precedence (env var > project config > global config) and three possible behaviors (always run, never run, run based on interval).

## Why

Currently, `stop_hook.run_interval_minutes` is only configurable in the global user config (`~/.config/agent-gauntlet/config.yml`). This limits flexibility:

1. **No project-level overrides** — Different projects may need different throttling strategies
2. **No environment variable support** — CI/CD pipelines and scripts cannot override without modifying config files
3. **No way to disable** — Users cannot fully disable the stop hook gauntlet without removing the hook

## Proposed Solution

### Two-Setting Design

Replace the single `run_interval_minutes` setting with two settings:

| Setting | Type | Default | Purpose |
|---------|------|---------|---------|
| `enabled` | boolean | `true` | Whether stop hook gauntlet runs at all |
| `run_interval_minutes` | number | `10` | Throttle frequency when enabled (0 = always run) |

**Behavior Matrix:**
- `enabled: false` → Never run (interval ignored)
- `enabled: true, interval: 0` → Always run
- `enabled: true, interval: 10` → Run every 10 minutes

### Configuration Precedence (High → Low)

1. **Environment Variables** (highest priority)
   - `GAUNTLET_STOP_HOOK_ENABLED` — accepts "true"/"false"/"1"/"0"
   - `GAUNTLET_STOP_HOOK_INTERVAL_MINUTES` — number

2. **Project Config** (`.gauntlet/config.yml`)
   ```yaml
   stop_hook:
     enabled: true
     run_interval_minutes: 5
   ```

3. **Global User Config** (`~/.config/agent-gauntlet/config.yml`) — lowest priority
   ```yaml
   stop_hook:
     enabled: true
     run_interval_minutes: 10
   ```

### Backwards Compatibility

- Default `enabled: true` and `run_interval_minutes: 10` preserves current behavior
- Existing global configs without `enabled` field will use the default

## Impact

### Affected Specs
- **stop-hook**: Modify "Global Configuration", "Stop Hook Run Interval", and "Status Codes for Approval Scenarios" requirements

### Affected Code
- `src/config/global.ts` — Add `enabled` field to stop_hook schema
- `src/config/schema.ts` — Add optional stop_hook section to project config
- `src/config/stop-hook-config.ts` — New file for config resolution
- `src/core/run-executor.ts` — Use resolved config instead of direct global config access
- `src/types/gauntlet-status.ts` — Add `stop_hook_disabled` status

## Spec Deltas

- **stop-hook**: Modify "Global Configuration" and "Stop Hook Run Interval" requirements to support multi-level configuration with new `enabled` setting. Modify "Status Codes for Approval Scenarios" to add the new `stop_hook_disabled` status code for when `enabled: false`

## Alternatives Considered

1. **Single setting with special values** (e.g., `0` = always, `-1` = never, `>0` = interval)
   - Rejected: mixing special values is less clear than explicit boolean + number

2. **Enum-based mode** (e.g., `mode: "always" | "never" | "interval"`)
   - Rejected: requires separate interval setting anyway, more complex schema

## Risks

- **Minimal**: Fully backwards compatible with defaults matching current behavior
