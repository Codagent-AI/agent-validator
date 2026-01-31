## Pre-factoring

### CodeScene Analysis

**File:** `src/commands/stop-hook.ts` — Code Health: **~6.5** (Yellow - problematic technical debt)

*Note: Since PR #25 merged, the file has grown from ~240 lines to ~360 lines with additional PR detection logic (`postGauntletPRCheck`, `checkPRStatus`, `shouldCheckPR`, `getPushPRInstructions`). This reinforces the need for the adapter architecture.*

| Code Smell | Function | Details | Severity |
|------------|----------|---------|----------|
| Bumpy Road Ahead | `registerStopHookCommand` | 2+ bumps of nested conditional logic | High |
| Complex Method | `registerStopHookCommand` | CC ~40+ (threshold: 9) | High |
| Large Method | `registerStopHookCommand` | ~360 lines (threshold: 70) | High |
| Complex Method | `getStatusMessage` | CC ~19 (threshold: 9) - includes `pr_push_required` | Medium |
| Code Duplication | `getLogDir`, `getDebugLogConfig`, `shouldCheckPR` | Similar config-reading patterns | Medium |

### Why Pre-factoring is Necessary

The `registerStopHookCommand` function has grown to ~360 lines with cyclomatic complexity around 40 after PR #25 added:
- `auto_push_pr` configuration resolution
- Post-gauntlet PR check step (`postGauntletPRCheck`)
- PR status detection (`checkPRStatus` using `gh` CLI)
- New `pr_push_required` blocking status handling

Adding Cursor protocol support directly would:
1. Increase complexity further (more conditional branches)
2. Make the bumpy road worse (deeper nesting for protocol detection)
3. Create maintenance burden when either protocol changes
4. Complicate the post-gauntlet PR check logic for Cursor output format

### Refactoring Strategy

The planned adapter architecture **naturally addresses all CodeScene issues** as part of the main implementation:

| Code Smell | How Adapter Pattern Resolves It |
|------------|--------------------------------|
| Large Method (~360 lines) | Split into: entry point (~100 lines), handler (~400 lines), adapters (~80 lines each) |
| Complex Method (CC~40) | Protocol branching moves to `adapter.detect()` polymorphism |
| Bumpy Road (2+ bumps) | Nested conditionals eliminated by adapter delegation |
| Complex Method in `getStatusMessage` | Moved to `StopHookHandler`, can be further simplified |
| Config reading duplication | Consolidated in handler initialization |

**No separate pre-factoring phase needed** — the adapter refactoring IS the refactoring. After implementation:
- Entry point: ~100 lines, CC < 5
- Each adapter: ~80 lines, CC < 10
- Handler: larger but focused on single responsibility (including post-gauntlet PR check)

## Context

The stop-hook command is tightly coupled to Claude Code's protocol. Cursor IDE uses a different protocol for stop hooks (followup_message-based continuation vs block/approve decisions). Adding Cursor support requires either duplicating logic or abstracting the protocol handling.

## Goals / Non-Goals

**Goals:**
- Support both Claude Code and Cursor stop hook protocols
- Clean separation between protocol handling and core gauntlet logic
- Easy to add future IDE support (e.g., Copilot, Codex)
- Maintain backward compatibility with existing Claude Code integrations

**Non-Goals:**
- Changing the gauntlet execution logic itself
- Supporting Cursor's other hook types (afterFileEdit, etc.)
- Auto-detecting IDE from environment (use input JSON detection)

## Architecture

Separate protocol-specific adapters from shared core logic:

```
┌─────────────────────────────────────────────────────────────────┐
│                    stop-hook.ts Entry Point                     │
│  ┌─────────────┐                                                │
│  │ Read stdin  │──► Detect protocol ──┬──► CursorStopHookAdapter│
│  └─────────────┘                      │                         │
│                                       └──► ClaudeStopHookAdapter│
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  StopHookHandler  │
                    │   (Core Logic)    │
                    └─────────┬─────────┘
                              │
                    ┌─────────▼─────────┐
                    │    executeRun()   │
                    │  (Gauntlet exec)  │
                    └─────────┬─────────┘
                              │
                    ┌─────────▼─────────┐
                    │postGauntletPRCheck│
                    │(if auto_push_pr)  │
                    └─────────┬─────────┘
                              │
                    ┌─────────▼─────────┐
                    │ adapter.format()  │
                    │ (Protocol output) │
                    └───────────────────┘
```

The `postGauntletPRCheck` step runs after gauntlet execution when:
- Status is `passed` or `passed_with_warnings`
- `auto_push_pr` is enabled in config

If no PR exists or PR is not up to date, the handler returns `pr_push_required` status with push-PR instructions. This is protocol-agnostic logic that lives in the handler.

## Key Protocol Differences

| Aspect          | Claude Code                    | Cursor                               |
| --------------- | ------------------------------ | ------------------------------------ |
| Block mechanism | `decision: "block"`            | `followup_message` with instructions |
| Allow mechanism | `decision: "approve"`          | Empty output `{}` / no followup      |
| Loop prevention | `stop_hook_active` input field | `loop_count` input field             |
| Max retries     | Custom (retry_limit_exceeded)  | Built-in `loop_limit` (default 5)    |
| Config location | `.claude/settings.json`        | `.cursor/hooks.json`                 |
| Working dir     | `cwd` field                    | `workspace_roots[0]`                 |
| Session ID      | `session_id`                   | `conversation_id`                    |

### Shared Gauntlet Features (Protocol-Agnostic)

The following features are gauntlet-level and work identically regardless of protocol:
- **`auto_push_pr` configuration**: 3-tier resolution (env var > project > global)
- **`pr_push_required` status**: When gates pass but no PR exists or PR is not up to date
- **Post-gauntlet PR check**: Uses `gh` CLI to verify PR state after gates pass

## Decisions

### Decision: Adapter Pattern for Protocol Handling

Use the adapter pattern with a `StopHookAdapter` interface:

```typescript
interface StopHookAdapter {
  name: string;
  detect(raw: Record<string, unknown>): boolean;
  parseInput(raw: Record<string, unknown>): StopHookContext;
  formatOutput(result: StopHookResult): string;
  shouldSkipExecution(ctx: StopHookContext): StopHookResult | null;
}
```

**Alternatives considered:**
1. **If/else in stop-hook.ts** - Simpler but leads to tangled code as protocols diverge
2. **Separate commands** (stop-hook-claude, stop-hook-cursor) - Breaks existing integrations, confusing UX
3. **Strategy pattern** - Similar to adapter but adapter better fits input/output transformation use case

**Rationale:** Adapter pattern provides clear separation, testability, and extensibility. Each adapter is ~50-100 lines, easy to understand and test independently.

### Decision: Protocol Detection via Input JSON

Detect protocol by checking for `cursor_version` field in stdin JSON:
- Present → Cursor protocol
- Absent → Claude Code protocol (default)

**Rationale:** Cursor always sends `cursor_version` in hook input. This is more reliable than environment variables or config files, and doesn't require user configuration.

### Decision: Cursor Loop Handling

Map Cursor's `loop_count` to existing retry limit logic:
- Cursor has built-in `loop_limit` (default 5, configurable in hooks.json)
- Our adapter checks `loop_count` and can return early if threshold exceeded
- This provides defense-in-depth alongside Cursor's built-in limit

**Rationale:** Cursor's loop_limit is per-script configurable. Having our own check ensures consistent behavior even if user misconfigures loop_limit.

## File Structure

```
src/
├── commands/
│   └── stop-hook.ts              # Entry point (~100 lines)
├── hooks/
│   ├── stop-hook-handler.ts      # Core logic (~400 lines)
│   └── adapters/
│       ├── types.ts              # Shared types (~50 lines)
│       ├── claude-stop-hook.ts   # Claude adapter (~80 lines)
│       └── cursor-stop-hook.ts   # Cursor adapter (~80 lines)
```

## Implementation Details

### Shared Types (`src/hooks/adapters/types.ts`)

```typescript
import type { GauntletStatus, RunResult } from "../../types/gauntlet-status.js";

// Protocol-agnostic context passed to handler
export interface StopHookContext {
  cwd: string;
  isNestedHook: boolean;      // stop_hook_active (Claude) or high loop_count (Cursor)
  loopCount?: number;         // Cursor only
  sessionId?: string;
  rawInput: Record<string, unknown>;  // Original parsed JSON for diagnostics
}

// Protocol-agnostic result from handler
export interface StopHookResult {
  status: GauntletStatus;
  shouldBlock: boolean;
  instructions?: string;      // Fix instructions when blocking (for failed status)
  pushPRReason?: string;      // PR push instructions when blocking (for pr_push_required status)
  message: string;            // Human-friendly status message
  intervalMinutes?: number;
  gateResults?: RunResult["gateResults"];
}

// Adapter interface
export interface StopHookAdapter {
  name: string;
  detect(raw: Record<string, unknown>): boolean;
  parseInput(raw: Record<string, unknown>): StopHookContext;
  formatOutput(result: StopHookResult): string;
  shouldSkipExecution(ctx: StopHookContext): StopHookResult | null;
}
```

### Core Handler (`src/hooks/stop-hook-handler.ts`)

Extract shared logic from current `src/commands/stop-hook.ts`:

```typescript
export class StopHookHandler {
  constructor(private debugLogger?: DebugLogger);
  
  // Main execution method
  async execute(ctx: StopHookContext): Promise<StopHookResult>;
  
  // Extracted helpers (currently in stop-hook.ts)
  private async checkGauntletConfig(cwd: string): Promise<boolean>;
  private async checkMarkerFile(logDir: string): Promise<boolean>;
  private async runGauntlet(cwd: string): Promise<RunResult>;
  private getStatusMessage(status: GauntletStatus, context?: {...}): string;
  private getStopReasonInstructions(gateResults?: RunResult["gateResults"]): string;
  
  // Post-gauntlet PR check (from PR #25)
  private async shouldCheckPR(cwd: string): Promise<boolean>;
  private async checkPRStatus(cwd: string): Promise<PRStatusResult>;
  private async postGauntletPRCheck(cwd: string, status: GauntletStatus): Promise<{
    finalStatus: GauntletStatus;
    pushPRReason?: string;
  }>;
  private getPushPRInstructions(options?: { hasWarnings?: boolean }): string;
}

interface PRStatusResult {
  prExists: boolean;
  upToDate: boolean;
  error?: string;
  prNumber?: number;
}
```

The handler's `execute()` method flow:
1. Check gauntlet config exists
2. Check marker file (nested hook detection)
3. Run gauntlet via `executeRun()`
4. **Post-gauntlet PR check** (if `auto_push_pr` enabled and status is `passed`/`passed_with_warnings`)
5. Build and return `StopHookResult` with final status

### Claude Adapter (`src/hooks/adapters/claude-stop-hook.ts`)

```typescript
export class ClaudeStopHookAdapter implements StopHookAdapter {
  name = "claude";
  
  detect(raw: Record<string, unknown>): boolean {
    // Claude Code doesn't send cursor_version
    return !("cursor_version" in raw);
  }
  
  parseInput(raw: Record<string, unknown>): StopHookContext {
    // Parse: { stop_hook_active, cwd, session_id, hook_event_name, ... }
    return {
      cwd: (raw.cwd as string) ?? process.cwd(),
      isNestedHook: raw.stop_hook_active === true,
      sessionId: raw.session_id as string | undefined,
      rawInput: raw,
    };
  }
  
  formatOutput(result: StopHookResult): string {
    // Output: { decision: "block"|"approve", reason, stopReason, status, message, ... }
    // Determine the appropriate reason/stopReason based on status
    const blockReason = result.status === "failed" 
      ? result.instructions 
      : result.status === "pr_push_required" 
        ? result.pushPRReason 
        : undefined;
    
    const response = {
      decision: result.shouldBlock ? "block" : "approve",
      stopReason: result.shouldBlock && blockReason ? blockReason : result.message,
      systemMessage: result.message,
      status: result.status,
      message: result.message,
      ...(result.shouldBlock && blockReason ? { reason: blockReason } : {}),
    };
    return JSON.stringify(response);
  }
  
  shouldSkipExecution(ctx: StopHookContext): StopHookResult | null {
    if (ctx.isNestedHook) {
      return { 
        status: "stop_hook_active", 
        shouldBlock: false, 
        message: "Stop hook cycle detected — allowing stop to prevent infinite loop." 
      };
    }
    return null;
  }
}
```

### Cursor Adapter (`src/hooks/adapters/cursor-stop-hook.ts`)

```typescript
export class CursorStopHookAdapter implements StopHookAdapter {
  name = "cursor";
  
  detect(raw: Record<string, unknown>): boolean {
    return "cursor_version" in raw || raw.hook_event_name === "stop";
  }
  
  parseInput(raw: Record<string, unknown>): StopHookContext {
    // Parse: { status, loop_count, cursor_version, workspace_roots, ... }
    const workspaceRoots = raw.workspace_roots;
    return {
      cwd: (Array.isArray(workspaceRoots) ? workspaceRoots[0] : null) ?? process.cwd(),
      isNestedHook: false,  // Cursor uses loop_count instead
      loopCount: raw.loop_count as number | undefined,
      sessionId: raw.conversation_id as string | undefined,
      rawInput: raw,
    };
  }
  
  formatOutput(result: StopHookResult): string {
    // Output: { followup_message?: "..." } or {}
    if (result.shouldBlock) {
      // Determine the appropriate message based on status
      // For `failed` status, use fix instructions
      // For `pr_push_required` status, use push-PR instructions
      const blockMessage = result.status === "failed"
        ? (result.instructions || result.message)
        : result.status === "pr_push_required"
          ? (result.pushPRReason || result.message)
          : result.message;
      
      return JSON.stringify({ followup_message: blockMessage });
    }
    return "{}";  // Empty = allow stop
  }
  
  shouldSkipExecution(ctx: StopHookContext): StopHookResult | null {
    // Cursor has built-in loop_limit (default 5), but we can check here too
    const MAX_LOOPS = 10;  // Configurable via loop_limit in hooks.json
    if (ctx.loopCount !== undefined && ctx.loopCount >= MAX_LOOPS) {
      return { 
        status: "retry_limit_exceeded", 
        shouldBlock: false, 
        message: "Loop limit reached — run `agent-gauntlet clean` to archive and continue."
      };
    }
    return null;
  }
}
```

### Refactored Entry Point (`src/commands/stop-hook.ts`)

Simplified to ~100 lines while retaining critical safety mechanisms:

```typescript
import { ClaudeStopHookAdapter } from "../hooks/adapters/claude-stop-hook.js";
import { CursorStopHookAdapter } from "../hooks/adapters/cursor-stop-hook.js";
import { StopHookHandler } from "../hooks/stop-hook-handler.js";

const STOP_HOOK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const adapters = [new CursorStopHookAdapter(), new ClaudeStopHookAdapter()];

export function registerStopHookCommand(program: Command): void {
  program.command("stop-hook").action(async () => {
    let adapter: StopHookAdapter = adapters[1]; // Default to Claude
    
    // Self-timeout: prevent zombie processes if Claude Code/Cursor times out
    const selfTimeout = setTimeout(() => {
      console.log(adapter.formatOutput({ 
        status: "error", shouldBlock: false, message: "stop hook timed out" 
      }));
      process.exit(0);
    }, STOP_HOOK_TIMEOUT_MS);
    selfTimeout.unref();
    
    try {
      // 1. Read stdin
      const raw = await readStdin();
      const parsed = JSON.parse(raw || "{}");
      
      // 2. Detect protocol and get adapter
      adapter = adapters.find(a => a.detect(parsed)) ?? adapters[1];
      
      // 3. Parse input
      const ctx = adapter.parseInput(parsed);
      
      // 4. Check for early exit
      const skipResult = adapter.shouldSkipExecution(ctx);
      if (skipResult) {
        console.log(adapter.formatOutput(skipResult));
        return;
      }
      
      // 5. Execute handler (includes gauntlet run + post-gauntlet PR check)
      const handler = new StopHookHandler();
      const result = await handler.execute(ctx);
      // result.status may be "pr_push_required" if auto_push_pr is enabled
      // and gates passed but no PR exists or PR is not up to date
      
      // 6. Output result (adapter handles protocol-specific formatting)
      console.log(adapter.formatOutput(result));
    } catch (error) {
      // Always output valid JSON on error to prevent IDE hang
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      console.log(adapter.formatOutput({ 
        status: "error", shouldBlock: false, message: errorMessage 
      }));
    } finally {
      clearTimeout(selfTimeout);
    }
  });
}
```

The handler's `execute()` method internally:
1. Runs the gauntlet via `executeRun()`
2. If status is `passed` or `passed_with_warnings` and `auto_push_pr` is enabled, runs `postGauntletPRCheck()`
3. Returns `StopHookResult` with final status (may be `pr_push_required`) and appropriate instructions

## Configuration Examples

**Claude Code** (`.claude/settings.json`):

```json
{
  "hooks": {
    "Stop": [{ "matcher": "", "hooks": ["agent-gauntlet stop-hook"] }]
  }
}
```

**Cursor** (`.cursor/hooks.json`):

```json
{
  "version": 1,
  "hooks": {
    "stop": [{ "command": "agent-gauntlet stop-hook", "loop_limit": 10 }]
  }
}
```

## Risks / Trade-offs

- **Risk:** Cursor protocol may change (beta feature)
  - Mitigation: Adapter isolation means changes are contained to one file
  
- **Risk:** Refactoring existing stop-hook.ts may introduce regressions
  - Mitigation: Comprehensive test coverage before refactoring; existing tests validate behavior

- **Trade-off:** More files vs monolithic command
  - Accepted: Cleaner separation worth the additional files; each file has single responsibility

## Migration Plan

1. Create new adapter infrastructure alongside existing code
2. Extract core logic into StopHookHandler
3. Create ClaudeStopHookAdapter wrapping existing behavior
4. Create CursorStopHookAdapter with new protocol
5. Refactor stop-hook.ts to use adapters
6. Run existing tests to verify Claude behavior unchanged
7. Add Cursor-specific tests

No user-facing migration needed; existing Claude Code configurations continue to work.

## Open Questions

None - protocol differences are well-documented by Cursor.
