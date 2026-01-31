# Code Health Improvements

This document tracks code health issues identified by CodeScene that are deferred for future work. When the `code-health` check fails, agents should make a reasonable attempt to fix issues and document here anything not being fixed, with reasons and suggestions.

## Deferred Issues

### String-Heavy Function Arguments

**File:** `src/hooks/stop-hook-handler.ts`
**Issue:** 47.1% of function arguments are strings (threshold: 39%)
**Why deferred:** Would require significant refactoring to create a `ProjectContext` type. The current approach is functional and the metric is a style guideline, not a bug.

**Affected functions:**
- `getLogDir(projectCwd: string)`
- `getDebugLogConfig(projectCwd: string)`
- `shouldCheckPR(projectCwd: string)`
- `checkPRStatus(cwd: string)`
- `postGauntletPRCheck(projectCwd: string, ...)`

**Suggested fix for future:**

```typescript
interface ProjectContext {
  cwd: string;
  config?: MinimalConfig;
}
```

This would reduce string passing but adds complexity. Consider if the codebase grows significantly.

### Test File Duplication

**Files:**
- `test/hooks/adapters/cursor-stop-hook.test.ts`
- `test/hooks/adapters/claude-stop-hook.test.ts`
- `test/hooks/stop-hook-handler.test.ts`
- `test/config/stop-hook-config.test.ts`

**Issue:** Similar test structures with repeated `StopHookResult` object creation and env var setup/teardown.
**Why deferred:** Test readability and independence are more important than DRY principles. Each test should be self-contained and easy to understand. This is acceptable in test code.

### Complex Methods (add-auto-fix-pr)

**File:** `src/hooks/stop-hook-handler.ts`
**Function:** `postGauntletPRCheck` (cyclomatic complexity: 16)
**Issue:** The CI workflow logic adds necessary branching for different CI states.
**Why deferred:** The complexity is inherent to the feature requirements - handling PR check, CI wait, retry tracking, and multiple CI states. Breaking this into smaller functions would obscure the flow.

**File:** `src/config/stop-hook-config.ts`
**Functions:** `parseStopHookEnvVars` (complexity: 20), `resolveStopHookConfig` (complexity: 15)
**Issue:** Each config field requires similar parsing/resolution logic.
**Why deferred:** The repetitive structure is intentional for consistency. A more abstract approach would reduce readability.

**File:** `src/hooks/adapters/claude-stop-hook.ts` and `cursor-stop-hook.ts`
**Function:** `formatOutput` (complexity: 10)
**Issue:** Each CI status requires specific output formatting.
**Why deferred:** The switch-like logic is the clearest way to handle status-specific formatting.

**File:** `src/commands/init.ts`
**Functions:** `promptAndInstallCommands`, `registerInitCommand`
**Issue:** Interactive prompts and command installation have inherent complexity.
**Why deferred:** These are initialization functions that run once. The complexity is acceptable for the user experience they provide.

### Primitive Obsession

**File:** `src/hooks/stop-hook-handler.ts`
**Issue:** 53.6% of function arguments are primitive types.
**Why deferred:** Same as String-Heavy Function Arguments above. Would require a `ProjectContext` type refactor.

**File:** `src/commands/wait-ci.ts`
**Issue:** 68.4% of function arguments are primitive types (threshold: 30%), 42.1% are strings (threshold: 39%)
**Why deferred:** The module deals with CLI commands and GitHub API interactions where string parameters (cwd, runId, etc.) are natural. Creating wrapper types would add complexity without improving readability. The code health score actually improved (9.38 -> 9.53) after refactoring for parallel log fetching.

## Notes

CodeScene's thresholds are guidelines, not hard rules. The current code is functional and maintainable. These improvements can be made opportunistically during related refactoring work.
