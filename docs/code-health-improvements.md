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

**Issue:** Similar test structures with repeated `StopHookResult` object creation.
**Why deferred:** Test readability and independence are more important than DRY principles. Each test should be self-contained and easy to understand. This is acceptable in test code.

## Notes

CodeScene's thresholds are guidelines, not hard rules. The current code is functional and maintainable. These improvements can be made opportunistically during related refactoring work.
