# Gauntlet-Run Subagent Delegation

## Problem

The `/gauntlet-run` skill fills the main agent's context window with large log files (check gate output) and JSON files (review gate output including raw AI reviewer responses). This is wasteful since most of the content is ephemeral processing detail that the main agent doesn't need to retain.

## Solution

Delegate file reading, error extraction, and JSON updating to subagents. The main agent only sees compact summaries and never reads log/json files directly.

## Architecture

Two synchronous subagent calls per retry cycle using the Task tool:

### EXTRACT Subagent (read-only)

- **Input:** Log directory path
- **Process:**
  1. List files directly under the log directory
  2. Read the highest-numbered `console.N.log` file
  3. For each `[FAIL]` line, read the referenced file:
     - `.json` files (reviews): Parse violations array, extract file/line/issue/priority/fix for violations with status `"new"`
     - `.log` files (checks): Extract error output, `--- Fix Instructions ---` sections, and `--- Fix Skill: <name> ---` sections
- **Output:** Compact plain-text summary of all failures

### UPDATE Subagent (write-only)

- **Input:** Log directory path + list of fix/skip decisions with result strings
- **Process:** For each decision, find the matching violation in the review JSON file by file + line + issue prefix, set `status` to "fixed" or "skipped", set `result` to the provided string
- **Output:** Confirmation of updates

### Main Agent Flow

```
1. bun src/index.ts clean (first run only)
2. bun src/index.ts run
3. On non-zero exit code:
   a. Infer log dir from console output paths
   b. Spawn EXTRACT subagent (haiku, general-purpose, synchronous)
   c. Fix code based on compact summary
      - Check failures with Fix Skill: invoke the skill
      - Check failures with Fix Instructions: follow them
      - Review violations: apply trust level, fix or skip
   d. Spawn UPDATE subagent (haiku, general-purpose, synchronous)
4. bun src/index.ts run (no clean)
5. Repeat 3-4 until pass/warnings/retry-limit
6. Provide summary
```

## File Structure

```
.claude/skills/gauntlet-run/
├── SKILL.md                  # Main orchestration instructions
├── extract-prompt.md         # Template for EXTRACT subagent
└── update-prompt.md          # Template for UPDATE subagent
```

## Key Decisions

- **Synchronous Task calls** (not `run_in_background`) to avoid the TaskOutput truncation bug and because the main agent needs the result before proceeding
- **Haiku model** for subagents since the work is mechanical (file parsing, JSON editing)
- **Separate prompt template files** to keep SKILL.md clean (pattern from superpowers:subagent-driven-development)
- **Main agent infers log dir** from console output paths rather than hardcoding, to support future multiple parallel sessions
- **Plain-text subagent responses** since the main agent consumes them as natural language, not programmatically

## Context Window Savings

Current state: main agent reads full `.log` files (potentially hundreds of lines of build/lint/test output) and full `.json` files (including `rawOutput` containing entire AI reviewer responses). Each review gate with `num_reviews > 1` multiplies this.

New state: main agent sees only a compact summary per gate (a few lines for checks, one line per violation for reviews). All file contents are absorbed by subagents whose context is discarded after they return.

## Pre-factoring

`src/commands/init.ts` — Code Health score: 9.09 (above 8.5 threshold). No pre-factoring required.

## Safety Constraints

The SKILL.md MUST include an explicit warning: "NEVER use `run_in_background: true` for subagent Task calls. All subagent calls MUST be synchronous." This prevents the model from optimizing by parallelizing subagent calls, which triggers a known TaskOutput truncation bug that returns raw JSONL instead of the subagent's answer.

## Implementation Scope

This change affects both the local project skill and the `init` command that generates it for all consumers:

1. **`src/commands/init.ts`** — `buildGauntletSkillContent("run")` must generate the new subagent-based skill content and write the prompt template files alongside SKILL.md
2. **`.claude/skills/gauntlet-run/`** — the local project's dev copy (3 files: SKILL.md, extract-prompt.md, update-prompt.md)

## Output Format

### EXTRACT — Check Failures

```
CHECKS:
- check:.:lint | FAIL | gauntlet_logs/check_._lint.1.log
  Errors: src/commands/init.ts format — Formatter would have printed different content (line 755-759)
  Fix Instructions: <extracted text if present>
  Fix Skill: <skill name if present>
```

### EXTRACT — Review Failures

```
REVIEWS:
- review:.:code-quality (claude@1) | FAIL | gauntlet_logs/review_._code-quality_claude@1.1.json
  [high] src/main.ts:45 — Missing error handling (fix: Add try-catch block)
  [medium] src/utils.ts:10 — Complex function (fix: Extract helper method)
```
