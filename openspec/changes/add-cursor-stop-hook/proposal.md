# Change: Add Cursor Stop Hook Support

## Why

The stop-hook command currently only supports Claude Code's protocol. Cursor IDE has a different stop hook protocol that uses `followup_message` for continuation instead of `decision: block/approve`. Adding native Cursor support enables Agent Gauntlet to validate gates automatically when Cursor's agent completes a task.

## What Changes

- Refactor stop-hook into adapter-based architecture separating protocol-specific code from shared logic
- Add `StopHookAdapter` interface for protocol implementations
- Create `ClaudeStopHookAdapter` with existing Claude Code protocol handling
- Create `CursorStopHookAdapter` with native Cursor protocol support
- Extract shared gauntlet execution logic into `StopHookHandler` class
- Add Cursor-specific documentation

## Impact

- Affected specs: `stop-hook`
- Affected code:
  - `src/commands/stop-hook.ts` (refactor to thin entry point)
  - `src/hooks/stop-hook-handler.ts` (new - core logic)
  - `src/hooks/adapters/types.ts` (new - shared types)
  - `src/hooks/adapters/claude-stop-hook.ts` (new - Claude adapter)
  - `src/hooks/adapters/cursor-stop-hook.ts` (new - Cursor adapter)
  - `test/commands/stop-hook.test.ts` (update for adapter architecture)
  - `docs/stop-hook-guide.md` (add Cursor section)
