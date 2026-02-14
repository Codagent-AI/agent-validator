# Gauntlet Auto-Invocation Design

## Problem

The gauntlet-run skill has `disable-model-invocation: true` and a vague description (`"Run the full verification gauntlet"`), so the agent never auto-invokes it. The stop hook is the only enforcement mechanism, but it's complex (recursion guards, timeouts, marker files) and disabled by default in config.

## Goal

Make `gauntlet-run` reliably self-invoke as the final verification step when an agent completes a coding task, using two complementary mechanisms:

1. **Skill auto-invocation** via improved frontmatter (description + flag)
2. **Start hook** that primes the agent at session start with explicit instructions

## Design

### Change 1: Skill Frontmatter

**File:** `src/commands/init.ts` (`buildGauntletSkillContent()`)
**Also:** `.claude/skills/gauntlet-run/SKILL.md` (this project's installed copy)

Update frontmatter in the template:

```yaml
# Before
name: gauntlet-run
description: Run the full verification gauntlet
disable-model-invocation: true
allowed-tools: Bash

# After
name: gauntlet-run
description: >-
  Run the full verification gauntlet. Use this as the final step after
  completing a coding task — verifies quality, runs checks, and ensures all
  gates pass. Must be run before committing, pushing, or creating PRs.
disable-model-invocation: false
allowed-tools: Bash
```

This gives Claude's auto-invocation logic a clear signal for *when* to invoke the skill.

### Change 2: Start Hook

A new `agent-gauntlet start-hook` CLI command that outputs context injection JSON, installed for both Claude Code and Cursor.

#### Start hook message

```
<IMPORTANT>
This project uses Agent Gauntlet for automated quality verification.

BEFORE reporting any coding task as complete, you MUST run /gauntlet-run
to verify your changes pass all quality gates.

Run /gauntlet-run when ALL of these are true:
  1. You completed a coding task (implemented a feature, fixed a bug,
     refactored code, or made other substantive code changes)
  2. You are about to report the work as done, complete, or fixed

Do NOT run /gauntlet-run when:
  - You only answered questions, explored code, or ran read-only commands
  - You are in the middle of a multi-step task (run it at the end, not
    after every individual change)
  - The user explicitly asked to skip verification

If you are unsure whether to run it, run it. False positives (running
unnecessarily) are far less costly than false negatives (skipping
verification on code that needed it).
</IMPORTANT>
```

#### Implementation

**New file: `src/commands/start-hook.ts`**

Simple command that:
1. Checks for `.gauntlet/config.yml` (fast exit if not a gauntlet project)
2. Accepts `--adapter` flag (`claude` or `cursor`, defaults to `claude`) to determine output format
3. Outputs the context injection in the appropriate format (JSON for Claude, plain text for Cursor)
4. Exits 0

Much simpler than stop-hook -- no stdin parsing, no recursion guards, no marker files. It's a pure context injection.

**Output format per CLI:**

Claude Code (`SessionStart` hook):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "<IMPORTANT>...</IMPORTANT>"
  }
}
```

Cursor (`beforeSubmitPrompt` hook):
Cursor's `beforeSubmitPrompt` hook receives the prompt via stdin and can inject additional context. The start-hook command outputs the context message so Cursor includes it as part of the agent's input.

#### Hook configs

**Claude Code** -- `SessionStart` in `.claude/settings.local.json`:

```typescript
const CLAUDE_START_HOOK_CONFIG = {
  hooks: {
    SessionStart: [
      {
        matcher: "startup|resume|clear|compact",
        hooks: [
          {
            type: "command",
            command: "agent-gauntlet start-hook",
            async: false,
          },
        ],
      },
    ],
  },
};
```

**Cursor** -- `beforeSubmitPrompt` in `.cursor/hooks.json`:

```typescript
const CURSOR_START_HOOK_CONFIG = {
  version: 1,
  hooks: {
    beforeSubmitPrompt: [
      {
        command: "agent-gauntlet start-hook --adapter cursor",
      },
    ],
  },
};
```

#### Installation functions

`installStartHook(projectRoot)` -- mirrors `installStopHook()`:
- Merges into existing `.claude/settings.local.json`
- Deduplicates (checks for existing `agent-gauntlet start-hook`)
- Merges into `SessionStart` array alongside any existing start hooks

`installCursorStartHook(projectRoot)` -- mirrors `installCursorStopHook()`:
- Merges into existing `.cursor/hooks.json`
- Deduplicates
- Merges into `beforeSubmitPrompt` array

Called from `registerInitCommand()`:

```typescript
// 3. Auto-install hooks for detected CLIs
if (availableAdapters.some((a) => a.name === "claude")) {
  await installStopHook(projectRoot);
  await installStartHook(projectRoot);
}
if (availableAdapters.some((a) => a.name === "cursor")) {
  await installCursorStopHook(projectRoot);
  await installCursorStartHook(projectRoot);
}
```

**Modified: `src/commands/index.ts`** -- export `registerStartHookCommand`
**Modified: `src/index.ts`** -- register the command

## Files Changed

| File | Change |
|------|--------|
| `src/commands/start-hook.ts` | New -- start hook CLI command |
| `src/commands/init.ts` | Update `buildGauntletSkillContent()` frontmatter, add start hook configs, install functions, call from init |
| `src/commands/index.ts` | Export new command |
| `src/index.ts` | Register new command |
| `.claude/skills/gauntlet-run/SKILL.md` | Update frontmatter to match new template |

## Pre-factoring

`src/commands/init.ts` has a Code Health score of 7.87 (below threshold 8.5).

CodeScene identified these code smells:
- **Complex Method**: `installStopHook` (cyclomatic complexity = 9), `installCommands` (cc = 9)
- **Code Duplication**: `installStopHook` (lines 758-818) and `installCursorStopHook` (lines 823-885) share nearly identical merge/dedup logic for reading a JSON settings file, deep-merging hook arrays, deduplicating by command string, and writing back
- **Primitive Obsession / String Heavy Arguments**: 40% of functions use primitive string arguments

**Refactoring strategy**: Before adding `installStartHook()` and `installCursorStartHook()` (which would duplicate the pattern a third and fourth time), extract the shared hook-merge logic into a reusable `mergeHookConfig(filePath, hookKey, hookEntry, deduplicateCmd)` helper. This reduces duplication from 2 copies to 0 and prevents the new functions from adding 2 more copies.

This refactoring is necessary because:
1. Without it, adding start hook installers would increase duplication from 2 to 4 copies
2. The complex method score (cc=9) on `installStopHook` is driven by the merge/dedup branching, which the helper would encapsulate
3. The new installer functions become trivial thin wrappers over the shared helper

## Why Both Mechanisms

- **Skill description** is the primary trigger -- Claude's auto-invocation sees "Use this as the final step after completing a coding task" and invokes it
- **Start hook** is belt-and-suspenders -- even if auto-invocation doesn't fire, the session-start message makes the agent aware of the requirement from the first message
- **Stop hook** remains as a hard enforcement layer (when enabled) -- catches cases where both soft mechanisms fail
