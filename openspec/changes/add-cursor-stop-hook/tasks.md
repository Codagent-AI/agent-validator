## 0. Pre-factoring

**File: `src/commands/stop-hook.ts`** — Code Health: 7.07 (Yellow - problematic technical debt)

CodeScene identified the following issues:

| Code Smell | Function | Details |
|------------|----------|---------|
| **Bumpy Road Ahead** | `registerStopHookCommand` | 2 bumps of nested conditional logic |
| **Complex Method** | `registerStopHookCommand` | CC = 36 (threshold: 9) |
| **Large Method** | `registerStopHookCommand` | 240 lines (threshold: 70) |
| **Complex Method** | `getStatusMessage` | CC = 17 (threshold: 9) |
| **Code Duplication** | `getLogDir`, `getDebugLogConfig` | Similar config-reading patterns |

**Refactoring strategy:** The planned adapter refactoring naturally addresses these issues:
- Extracting protocol-specific logic into adapters reduces `registerStopHookCommand` complexity
- Moving core logic to `StopHookHandler` reduces the function size from 240 lines to ~100 lines
- The adapter pattern eliminates nested conditionals (bumpy road) by delegating to polymorphic methods

Pre-factoring tasks (addressed by main implementation):
- [ ] 0.1 Extract `registerStopHookCommand` core logic into `StopHookHandler.execute()` — addresses Large Method, Complex Method
- [ ] 0.2 Move protocol detection/parsing into adapters — addresses Bumpy Road (nested conditionals)
- [ ] 0.3 Extract status message generation into handler — addresses Complex Method in `getStatusMessage`

## 1. Implementation

- [ ] 1.1 Create `src/hooks/adapters/types.ts` with `StopHookAdapter` interface, `StopHookContext`, and `StopHookResult` types
- [ ] 1.2 Create `src/hooks/stop-hook-handler.ts` extracting core logic from `src/commands/stop-hook.ts`
- [ ] 1.3 Create `src/hooks/adapters/claude-stop-hook.ts` implementing `StopHookAdapter` for Claude Code protocol
- [ ] 1.4 Create `src/hooks/adapters/cursor-stop-hook.ts` implementing `StopHookAdapter` for Cursor protocol
- [ ] 1.5 Refactor `src/commands/stop-hook.ts` to use adapters (thin entry point)
- [ ] 1.6 Update exports in `src/commands/index.ts` if needed

## 2. Tests

- [ ] 2.1 Unit tests for `StopHookHandler` core logic
- [ ] 2.2 Unit tests for `ClaudeStopHookAdapter.detect()` and `parseInput()`
- [ ] 2.3 Unit tests for `ClaudeStopHookAdapter.formatOutput()` for all status types
- [ ] 2.4 Unit tests for `CursorStopHookAdapter.detect()` and `parseInput()`
- [ ] 2.5 Unit tests for `CursorStopHookAdapter.formatOutput()` with followup_message
- [ ] 2.6 Unit tests for `CursorStopHookAdapter.shouldSkipExecution()` loop_count handling
- [ ] 2.7 Integration test for end-to-end stop-hook with Claude input
- [ ] 2.8 Integration test for end-to-end stop-hook with Cursor input

## 3. Documentation

- [ ] 3.1 Add Cursor section to `docs/stop-hook-guide.md`
- [ ] 3.2 Document `.cursor/hooks.json` configuration format
- [ ] 3.3 Document protocol differences between Claude Code and Cursor

## 4. Validation

There are no validation tasks that need to be explicitly run. When work is completed, a stop hook should execute the full gauntlet of verification tasks and give direction on what needs to be fixed.
