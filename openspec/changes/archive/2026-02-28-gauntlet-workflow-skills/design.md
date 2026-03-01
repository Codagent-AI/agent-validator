## Context

Agent-gauntlet ships a set of skills in `skills/` that agents invoke via slash commands. Three workflow gaps exist: (1) committing without running gauntlet leaves the next run's change detection starting from the pre-commit baseline rather than the committed state; (2) merging a validated branch into a worktree forces redundant re-validation because the execution state doesn't transfer with the merge; (3) there is no frictionless path from a suspected bug to a GitHub issue. A fourth gap is that `gauntlet-help` diagnoses but never acts on high-confidence bug findings.

All new skills use `agent-gauntlet <command>` (not `bun src/index.ts`) and are placed in `skills/` alongside existing skills.

## Goals / Non-Goals

**Goals:**
- `gauntlet-commit`: Gate commits behind optional gauntlet validation; let the agent choose a validation level (or accept one inline); commit using an available commit skill if present.
- `gauntlet-merge`: Merge a branch and propagate its validated execution state to the current directory, eliminating redundant re-validation.
- `gauntlet-issue`: Collect diagnostic evidence, preview a structured GitHub issue, and file it on `pacaplan/agent-gauntlet` after confirmation.
- `gauntlet-help`: Auto-invoke `gauntlet-issue` on high-confidence bugs; prompt on medium confidence.

**Non-Goals:**
- Modifying the `agent-gauntlet` CLI source or configuration schema.
- Handling merge conflicts in `gauntlet-merge`.
- Pushing or creating PRs (out of scope for these skills).
- Modifying `.claude/skills/` — all new files go in `skills/`.

## Decisions

### gauntlet-commit

**Inline argument parsing.** The skill receives `$ARGUMENTS` as a free-text string. It parses it for intent: words like "run", "full", "all gates" → invoke `gauntlet-run`; "check", "checks only" → invoke `gauntlet-check`; "skip" → invoke `agent-gauntlet skip`. If `$ARGUMENTS` contains no clear intent, the skill prompts the user to choose.

**No-changes path.** If `agent-gauntlet detect` finds no changes, skip validation entirely and go straight to the commit step. No prompt needed.

**Failure handling.** If the chosen validation fails, the skill fixes failures (per the invoked skill's protocol) and then asks the user "Ready to commit?" before proceeding. It does not auto-commit after a fix cycle.

**Commit step.** The skill checks whether a commit skill is available (by looking for a commit skill directory under `skills/`). If found, it invokes that skill. Otherwise it stages relevant changes and drafts a commit message at the agent's discretion.

**Execution state.** No manual state update needed after commit — `agent-gauntlet run`, `agent-gauntlet check`, and `agent-gauntlet skip` all update execution state as part of their normal operation.

**File:** `skills/gauntlet-commit/SKILL.md`, `disable-model-invocation: false`

---

### gauntlet-merge

**Script-driven.** All deterministic steps (worktree discovery, config parsing, file copy) are handled by a shell script `skills/gauntlet-merge/merge-state.sh`. The SKILL.md invokes the script and reports the result. This avoids fragile step-by-step agent execution of git plumbing commands.

**Script behavior (`merge-state.sh <branch>`):**
1. Parse `git worktree list --porcelain` to find the entry whose `branch` field matches `refs/heads/<branch>`. The first entry is always the main clone; all entries are checked.
2. If no match found: exit non-zero with message "No worktree found with branch '<branch>' checked out — cannot copy execution state."
3. Run `git merge <branch>`.
4. Read `<source_dir>/.gauntlet/config.yml`, extract `log_dir` (default: `gauntlet_logs`).
5. Read current dir's `.gauntlet/config.yml`, extract `log_dir` (default: `gauntlet_logs`).
6. Copy `<source_log_dir>/.execution_state` to `<dest_log_dir>/.execution_state`. Create dest log dir if it doesn't exist.

**Invocation:** `/gauntlet-merge <branch-name>` — `$ARGUMENTS` is the branch name passed directly to the script.

**File:** `skills/gauntlet-merge/SKILL.md`, `skills/gauntlet-merge/merge-state.sh`, `disable-model-invocation: false`

---

### gauntlet-issue

**Evidence collection.** The skill reads `.gauntlet/config.yml` to locate `log_dir`, then collects: the last 50 lines of `<log_dir>/.debug.log`, the full `<log_dir>/.execution_state`, and `.gauntlet/config.yml` (redacting any secrets).

**Bug description.** If `$ARGUMENTS` contains a description, use it. Otherwise ask the user for one before proceeding.

**Issue structure:**
- **Title:** concise one-line summary
- **Problem:** user's description
- **Steps to Reproduce:** inferred from evidence or asked
- **Expected vs Actual:** what should have happened vs what did
- **Evidence:** relevant excerpts from debug log and execution state

**Preview and confirm.** Show the full issue body before filing. File only after user confirms.

**Filing:** `gh issue create --repo pacaplan/agent-gauntlet --title "..." --body "..."`. Report the created issue URL.

**File:** `skills/gauntlet-issue/SKILL.md`, `disable-model-invocation: false`

---

### gauntlet-help modification

Append a new **Bug Filing** section to `skills/gauntlet-help/SKILL.md` that runs after the existing Output Contract:

- **High confidence** → automatically invoke `gauntlet-issue`, passing the diagnosis as the bug description.
- **Medium confidence** → ask: "This may be a gauntlet bug. Want me to file a GitHub issue?"
- **Low confidence** → no action.

## Risks / Trade-offs

- **`gauntlet-merge` requires the branch to be checked out somewhere.** If the user deleted the worktree after merging, the execution state is gone and they get an error. Acceptable — documented in the skill.
- **`gauntlet-issue` requires `gh` CLI.** If not installed, `gh issue create` will fail with a clear error. No fallback needed.
- **`gauntlet-commit` inline parsing is fuzzy.** Free-text intent parsing can misfire. Acceptable risk — the skill falls back to prompting when intent is unclear.
- **`merge-state.sh` overwrites execution state without backup.** Per the proposal: no conflict handling, just overwrite. Acceptable — the old state is stale once a merge happens.

## Migration Plan

- Add `skills/gauntlet-commit/SKILL.md`
- Add `skills/gauntlet-merge/SKILL.md` and `skills/gauntlet-merge/merge-state.sh`
- Add `skills/gauntlet-issue/SKILL.md`
- Edit `skills/gauntlet-help/SKILL.md` to append the Bug Filing section
- No CLI changes, no config changes, no migration of existing state

## Open Questions

- None — all decisions resolved during design.
