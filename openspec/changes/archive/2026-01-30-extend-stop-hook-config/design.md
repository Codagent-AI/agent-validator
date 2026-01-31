# Design: extend-stop-hook-config

## Architecture Overview

This change introduces a configuration resolver pattern for stop hook settings, allowing values to be sourced from three levels with clear precedence.

```
┌─────────────────────────────────────────────────────────────┐
│                    Configuration Sources                     │
├─────────────────────────────────────────────────────────────┤
│  1. Environment Variables (highest)                         │
│     GAUNTLET_STOP_HOOK_ENABLED                              │
│     GAUNTLET_STOP_HOOK_INTERVAL_MINUTES                     │
│                         ↓                                    │
│  2. Project Config (.gauntlet/config.yml)                   │
│     stop_hook.enabled                                        │
│     stop_hook.run_interval_minutes                          │
│                         ↓                                    │
│  3. Global Config (~/.config/agent-gauntlet/config.yml)     │
│     stop_hook.enabled                                        │
│     stop_hook.run_interval_minutes                          │
└─────────────────────────────────────────────────────────────┘
                          ↓
              resolveStopHookConfig()
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                   StopHookConfig                             │
│  { enabled: boolean, run_interval_minutes: number }         │
└─────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. Separate Config Resolver Module

Create `src/config/stop-hook-config.ts` to encapsulate:
- Environment variable parsing with validation
- Multi-source merging logic
- Type definitions

This follows the existing pattern used by `mergeDebugLogConfig()` in `src/utils/debug-log.ts`.

### 2. Environment Variable Naming

Use `GAUNTLET_` prefix for consistency with internal control variables (e.g., `GAUNTLET_STOP_HOOK_ACTIVE`):
- `GAUNTLET_STOP_HOOK_ENABLED` — boolean-like values
- `GAUNTLET_STOP_HOOK_INTERVAL_MINUTES` — numeric

### 3. Per-Field Precedence

Each field is resolved independently:
```typescript
// User could set enabled via env var but interval via project config
GAUNTLET_STOP_HOOK_ENABLED=true  // from env
# .gauntlet/config.yml
stop_hook:
  run_interval_minutes: 5  # from project
```

### 4. Interval = 0 Means "Always Run"

When `enabled: true` and `run_interval_minutes: 0`, the gauntlet runs on every stop attempt. This is implemented by short-circuiting the interval check when interval is 0.

## Schema Changes

### Global Config (`src/config/global.ts`)

```typescript
// Before
stop_hook: z.object({
  run_interval_minutes: z.number().default(10),
}).default({ run_interval_minutes: 10 })

// After
stop_hook: z.object({
  enabled: z.boolean().default(true),
  run_interval_minutes: z.number().default(10),
}).default({ enabled: true, run_interval_minutes: 10 })
```

### Project Config (`src/config/schema.ts`)

```typescript
// Add new optional section
stop_hook: z.object({
  enabled: z.boolean().optional(),
  run_interval_minutes: z.number().optional(),
}).optional()
```

## Integration Points

### run-executor.ts

Replace:
```typescript
const intervalMinutes = globalConfig.stop_hook.run_interval_minutes;
const shouldRun = await shouldRunBasedOnInterval(logDir, intervalMinutes);
```

With:
```typescript
const stopHookConfig = resolveStopHookConfig(config.project.stop_hook, globalConfig);

// Check if stop hook is disabled
if (!stopHookConfig.enabled) {
  return { status: "stop_hook_disabled", message: "Stop hook is disabled" };
}

// Check interval (0 = always run, skip interval check)
if (stopHookConfig.run_interval_minutes > 0) {
  const shouldRun = await shouldRunBasedOnInterval(
    logDir,
    stopHookConfig.run_interval_minutes
  );
  if (!shouldRun) { ... }
}
```

## New Status: `stop_hook_disabled`

Add to `GauntletStatus` type for when `enabled: false`:
- Decision: approve (allow stop)
- Message: "Stop hook is disabled via configuration"
