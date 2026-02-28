---
name: gauntlet-commit
description: >-
  Gates commits behind optional gauntlet validation by detecting changes, running selected validations, handling failures, and completing the commit flow.
  Activates when requests include "commit with gauntlet", "run checks before commit", "run gauntlet then commit", or "skip gauntlet and commit".
disable-model-invocation: false
allowed-tools: Bash, Task
---

# /gauntlet-commit $ARGUMENTS

Commit with optional gauntlet validation. Runs `agent-gauntlet detect` first, validates based on intent (full run, checks only, or skip), handles failures, then commits.

## Step 1 - Detect Changes

Run `agent-gauntlet detect` using `Bash`:

```bash
agent-gauntlet detect 2>&1
```

- If no changed files are reported → **skip to Step 4** (commit directly, no validation needed)
- If changed files are reported → continue to Step 2

## Step 2 - Determine Validation Intent

Parse `$ARGUMENTS` for a validation intent. Do not prompt the user if a clear intent is found.

| ARGUMENTS pattern | Action |
|-------------------|--------|
| Contains "run", "full", or "all gates" | Invoke `/gauntlet-run` (Step 3a) |
| Contains "check" or "checks" | Invoke `/gauntlet-check` (Step 3b) |
| Contains "skip" | Run `agent-gauntlet skip 2>&1` (Step 3c), then go to Step 4 |
| Empty or no clear intent | Present the three choices below to the user, wait for selection |

**When prompting the user**, present these choices:

1. **Run all gates** — full validation (checks + reviews)
2. **Run checks only** — checks without AI reviews
3. **Skip gauntlet** — advance baseline without running any gates

Then proceed to the step matching the user's selection.

## Step 3a - Full Validation (gauntlet-run)

Invoke `/gauntlet-run`.

- If it passes → go to Step 4
- If it fails → the `/gauntlet-run` skill handles fixing and re-running. After that skill completes, ask the user: **"Ready to commit?"**. Proceed to Step 4 only on confirmation.

## Step 3b - Checks-Only Validation (gauntlet-check)

Invoke `/gauntlet-check`.

- If it passes → go to Step 4
- If it fails → the `/gauntlet-check` skill handles fixing and re-running. After that skill completes, ask the user: **"Ready to commit?"**. Proceed to Step 4 only on confirmation.

## Step 3c - Skip Validation

Run:

```bash
agent-gauntlet skip 2>&1
```

Report the command output to the user, then go to Step 4.

## Step 4 - Commit

Check whether you have a skill for committing git changes available.

- **If a commit skill is found** → invoke that skill to perform the commit
- **If no commit skill is found** → stage all tracked changespropose a commit message following the conventional commits format (`<type>: <description>`), then run `git commit -m "<message>"`
