---
name: validator-commit
description: >-
  Handles commit flows by detecting changes, optionally running gauntlet validation, and completing commits for requests such as "commit with gauntlet", "run checks before commit", "run gauntlet then commit", or "skip gauntlet and commit".
disable-model-invocation: false
allowed-tools: Bash, Task
---

# /validator-commit $ARGUMENTS

Commit with optional gauntlet validation. Runs `agent-validate detect` first, validates based on intent (full run, checks only, or skip), handles failures, then commits.

## Step 1 - Detect Changes

Run `agent-validate detect` using `Bash`:

```bash
agent-validate detect 2>&1; echo "DETECT_EXIT:$?"
```

Check the exit code from the `DETECT_EXIT:` line:

- **Exit 0** → gates would run, continue to Step 2
- **Exit 2** → no gates would run (no changes or no applicable gates), **skip to Step 4** (commit directly)
- **Exit 1** → error, report the error to the user and stop
- **Any other exit code** → treat as error, report output to the user, and stop

## Step 2 - Determine Validation Intent

Parse `$ARGUMENTS` for a validation intent. Do not prompt the user if a clear intent is found.

| ARGUMENTS pattern | Action |
|-------------------|--------|
| Contains "run", "full", or "all gates" | Invoke `/validator-run` (Step 3a) |
| Contains "check" or "checks" | Invoke `/validator-check` (Step 3b) |
| Contains "skip" | Run `agent-validate skip 2>&1` (Step 3c), then go to Step 4 |
| Empty or no clear intent | Present the three choices below to the user, wait for selection |

**When prompting the user**, present these choices:

1. **Run all gates** — full validation (checks + reviews)
2. **Run checks only** — checks without AI reviews
3. **Skip gauntlet** — advance baseline without running any gates

Then proceed to the step matching the user's selection.

## Step 3a - Full Validation (validator-run)

Invoke `/validator-run`.

- If it passes → go to Step 4
- If it fails → the `/validator-run` skill handles fixing and re-running. After that skill completes, ask the user: **"Ready to commit?"**. Proceed to Step 4 only on confirmation.

## Step 3b - Checks-Only Validation (validator-check)

Invoke `/validator-check`.

- If it passes → go to Step 4
- If it fails → the `/validator-check` skill handles fixing and re-running. After that skill completes, ask the user: **"Ready to commit?"**. Proceed to Step 4 only on confirmation.

## Step 3c - Skip Validation

Run:

```bash
agent-validate skip 2>&1
```

Report the command output to the user, then go to Step 4.

## Step 4 - Commit

Check whether you have a skill for committing git changes available (excluding `validator-commit` itself to avoid self-invocation).

- **If a commit skill is found** → invoke that skill to perform the commit
- **If no commit skill is found** → stage all tracked changes, propose a commit message following the conventional commits format (`<type>: <description>`), then run `git commit -m "<message>"`
