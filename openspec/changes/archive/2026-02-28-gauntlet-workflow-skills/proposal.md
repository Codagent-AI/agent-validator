## Why

Three workflow gaps exist in agent-gauntlet's skill surface: commits leave execution state out of sync (causing false re-validation on the next change), merging validated branches forces redundant gauntlet runs, and suspected bugs have no frictionless path to a GitHub issue. These gaps slow down daily use and erode trust in gauntlet's change-detection signals.

## What Changes

- New `/gauntlet-commit` skill that runs `detect` before committing and, when changes are found, lets the user choose full validation (`gauntlet-run`), checks-only (`gauntlet-check`), or skip — with inline option support so no prompt appears when the user already specified intent.
- New `/gauntlet-merge <branch>` skill that performs a `git merge` of the named branch, locates the worktree or clone directory where that branch is checked out, and copies its `.execution_state` file to the current directory — eliminating redundant re-validation of already-verified changes.
- New `/gauntlet-issue` skill that collects diagnostic evidence (logs, config, execution state) and creates a GitHub issue on `pacaplan/agent-gauntlet` with a structured bug report.
- Modified `gauntlet-help` skill: after completing a diagnosis, if the evidence points to a likely bug it SHALL automatically invoke `gauntlet-issue`; if confidence is medium it SHALL ask the user whether to file a bug.

## Capabilities

### New Capabilities

- `gauntlet-commit`: Skill that gates commits behind a `detect` check, surfaces the user's choice of validation level (or accepts an inline option), then commits with a synchronized execution state.
- `gauntlet-merge`: Skill that merges a named branch and propagates its validated `.execution_state` to the current directory, found by scanning git worktrees and the main clone for the branch checkout location.
- `gauntlet-issue`: Skill that collects gauntlet runtime evidence and opens a structured GitHub issue for a suspected bug.

### Modified Capabilities

- `agent-command`: Extended `gauntlet-help` post-diagnosis behavior — high-confidence bugs auto-invoke `gauntlet-issue`; medium-confidence bugs prompt the user to file one.

## Impact

- Three new skill files under `skills/`
- `skills/gauntlet-help/SKILL.md` updated to add bug-filing routing logic
- No changes to gauntlet CLI source or configuration schema
- Requires `gh` CLI available for `gauntlet-issue` to create issues
