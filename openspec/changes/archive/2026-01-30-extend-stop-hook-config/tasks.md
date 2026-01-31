# Tasks

## 1. Update Global Config Schema

- [x] Add `enabled: z.boolean().default(true)` to `stop_hook` schema in `src/config/global.ts`
- [x] Update `DEFAULT_GLOBAL_CONFIG` to include `enabled: true`
- [x] Verify backwards compatibility with existing configs

## 2. Update Project Config Schema

- [x] Add optional `stop_hook` section to `gauntletConfigSchema` in `src/config/schema.ts`
- [x] Define `stopHookConfigSchema` with optional `enabled` and `run_interval_minutes` fields

## 3. Create Config Resolver

- [x] Create `src/config/stop-hook-config.ts`
- [x] Define `StopHookConfig` type
- [x] Define environment variable constants (`GAUNTLET_STOP_HOOK_ENABLED`, `GAUNTLET_STOP_HOOK_INTERVAL_MINUTES`)
- [x] Implement `parseStopHookEnvVars()` with validation
- [x] Implement `resolveStopHookConfig(projectConfig?, globalConfig)` with precedence logic

## 4. Add New Status Type

- [x] Add `stop_hook_disabled` to `GauntletStatus` type in `src/types/gauntlet-status.ts`
- [x] Update `getStatusMessage()` in `src/core/run-executor.ts`

## 5. Update Run Executor

- [x] Import `resolveStopHookConfig` in `src/core/run-executor.ts`
- [x] Replace direct `globalConfig.stop_hook.run_interval_minutes` access with resolved config
- [x] Add early return for `enabled: false` case
- [x] Handle `interval: 0` as "always run" (skip interval check)

## 6. Testing

- [x] Test: Config precedence (env var > project > global) resolves correctly
- [x] Test: `enabled: false` skips gauntlet and returns `stop_hook_disabled` status
- [x] Test: `interval: 0` always runs without checking elapsed time
- [x] Test: Backwards compatibility — missing `enabled` field defaults to `true`
- [x] Test: Env var parsing accepts valid values and ignores invalid ones
- [x] Test: Interval check returns `interval_not_elapsed` when not elapsed

## Validation

Run `openspec validate extend-stop-hook-config --strict --no-interactive` to validate the change, run the full test suite, and run the gauntlet dogfood to verify end-to-end behavior.
