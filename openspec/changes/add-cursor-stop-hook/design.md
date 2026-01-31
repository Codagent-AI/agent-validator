## Pre-factoring

### CodeScene Analysis

**File:** `src/commands/stop-hook.ts` — Code Health: **7.07** (Yellow - problematic technical debt)

| Code Smell | Function | Details | Severity |
|------------|----------|---------|----------|
| Bumpy Road Ahead | `registerStopHookCommand` | 2 bumps of nested conditional logic | High |
| Complex Method | `registerStopHookCommand` | CC = 36 (threshold: 9) | High |
| Large Method | `registerStopHookCommand` | 240 lines (threshold: 70) | High |
| Complex Method | `getStatusMessage` | CC = 17 (threshold: 9) | Medium |
| Code Duplication | `getLogDir`, `getDebugLogConfig` | Similar config-reading patterns | Low |

### Why Pre-factoring is Necessary

The `registerStopHookCommand` function is a 240-line monolith with cyclomatic complexity of 36. Adding Cursor protocol support directly would:
1. Increase complexity further (more conditional branches)
2. Make the bumpy road worse (deeper nesting for protocol detection)
3. Create maintenance burden when either protocol changes

### Refactoring Strategy

The planned adapter architecture **naturally addresses all CodeScene issues** as part of the main implementation:

| Code Smell | How Adapter Pattern Resolves It |
|------------|--------------------------------|
| Large Method (240 lines) | Split into: entry point (~100 lines), handler (~300 lines), adapters (~80 lines each) |
| Complex Method (CC=36) | Protocol branching moves to `adapter.detect()` polymorphism |
| Bumpy Road (2 bumps) | Nested conditionals eliminated by adapter delegation |
| Complex Method in `getStatusMessage` | Moved to `StopHookHandler`, can be further simplified |

**No separate pre-factoring phase needed** — the adapter refactoring IS the refactoring. After implementation:
- Entry point: ~100 lines, CC < 5
- Each adapter: ~80 lines, CC < 10
- Handler: larger but focused on single responsibility

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
                    └───────────────────┘
```

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
  instructions?: string;      // Fix instructions when blocking
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
}
```

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
    const response = {
      decision: result.shouldBlock ? "block" : "approve",
      stopReason: result.shouldBlock && result.instructions ? result.instructions : result.message,
      systemMessage: result.message,
      status: result.status,
      message: result.message,
      ...(result.shouldBlock && result.instructions ? { reason: result.instructions } : {}),
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
      // Always return followup_message when blocking, fallback to message if instructions missing
      return JSON.stringify({ followup_message: result.instructions || result.message });
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
      
      // 5. Execute handler (includes debug logging internally)
      const handler = new StopHookHandler();
      const result = await handler.execute(ctx);
      
      // 6. Output result
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
