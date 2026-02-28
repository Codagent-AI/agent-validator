# Task: gauntlet-merge skill

## Goal

Create `skills/gauntlet-merge/SKILL.md` and `skills/gauntlet-merge/merge-state.sh` — a skill that merges a named branch and propagates the validated execution state from that branch's worktree, eliminating redundant re-validation.

## Background

**Skill conventions.** All skills in this repo live in `skills/<name>/SKILL.md`. Read `skills/gauntlet-run/SKILL.md` to understand the frontmatter and structure conventions. Some skills ship helper files alongside SKILL.md (e.g. `skills/gauntlet-run/extract-prompt.md`); this skill ships a shell script the same way.

**ARGUMENTS.** The user invokes this skill as `/gauntlet-merge <branch-name>`. `$ARGUMENTS` will contain the branch name (e.g. `feature-branch-a`). The SKILL.md should pass `$ARGUMENTS` directly to the script.

**Script-driven design.** All deterministic steps — git operations, worktree discovery, config parsing, file copy — are handled by `merge-state.sh`. The SKILL.md invokes the script and reports the result. This avoids fragile agent-driven git plumbing.

**Script behavior (`merge-state.sh <branch>`):**
1. Parse `git worktree list --porcelain` to find the entry whose `branch` line is `refs/heads/<branch>`. The first entry in porcelain output is always the main clone — treat it as a valid candidate alongside linked worktrees. Porcelain format:
   ```
   worktree /path/to/dir
   HEAD <sha>
   branch refs/heads/<branchname>

   worktree /path/to/other
   HEAD <sha>
   detached
   ```
3. If no match found: print `Error: No worktree found with branch '<branch>' checked out — cannot copy execution state.` and exit non-zero.
4. Run `git merge <branch>`.
5. Read `<source_dir>/.gauntlet/config.yml` and extract `log_dir` (default `gauntlet_logs` if not set). Use `grep` or similar; no JSON/YAML parser required — `log_dir:` is a simple key-value line.
6. Read current directory's `.gauntlet/config.yml` and extract `log_dir` (default `gauntlet_logs`).
7. Create the destination log directory if it doesn't exist (`mkdir -p`).
8. Copy `<source_log_dir>/.execution_state` → `<dest_log_dir>/.execution_state`, overwriting without prompting.

**Script location and invocation.** The script lives at `skills/gauntlet-merge/merge-state.sh` and must be executable. The SKILL.md invokes it with `bash skills/gauntlet-merge/merge-state.sh "$ARGUMENTS"` (or equivalent). Report the script's output and exit status to the user.

**`disable-model-invocation: false`** — the skill needs to report results and handle errors conversationally.

## Spec

### Requirement: Branch Merge with Execution State Propagation

The `gauntlet-merge` skill SHALL merge a named branch into the current directory and propagate the execution state from the worktree where that branch is checked out, eliminating redundant re-validation of already-verified changes.

#### Scenario: Successful merge with worktree found

- **WHEN** ARGUMENTS contains a valid branch name
- **AND** that branch is checked out in some worktree (including the main clone)
- **THEN** the skill SHALL merge the branch into the current directory
- **AND** SHALL copy the execution state file from the source worktree's log directory to the current directory's log directory

#### Scenario: Branch not checked out anywhere

- **WHEN** ARGUMENTS contains a branch name that is not checked out in any worktree or the main clone
- **THEN** the skill SHALL report an error: "No worktree found with branch '<branch>' checked out — cannot copy execution state"
- **AND** SHALL NOT proceed with the merge

### Requirement: Script-Driven Worktree Discovery and State Copy

A shell script SHALL handle all deterministic steps of the merge workflow: git operations, worktree discovery, config parsing, and file copy.

#### Scenario: Worktree discovery via porcelain output

- **WHEN** the script runs `git worktree list --porcelain`
- **THEN** it SHALL parse the output to find the worktree entry whose branch field matches `refs/heads/<branch>`
- **AND** SHALL treat the first entry (main clone) as a valid candidate alongside linked worktrees

#### Scenario: Source log directory resolved from config

- **WHEN** the source worktree directory is found
- **THEN** the script SHALL read `<source_dir>/.gauntlet/config.yml` to extract its `log_dir` value
- **AND** SHALL default to `gauntlet_logs` if `log_dir` is not specified

#### Scenario: Destination log directory resolved from config

- **WHEN** preparing to copy the execution state
- **THEN** the script SHALL read the current directory's `.gauntlet/config.yml` to extract its `log_dir` value
- **AND** SHALL default to `gauntlet_logs` if `log_dir` is not specified
- **AND** SHALL create the destination log directory if it does not exist

#### Scenario: Execution state overwrite

- **WHEN** the source execution state file exists and the destination is resolved
- **THEN** the script SHALL copy `<source_log_dir>/.execution_state` to `<dest_log_dir>/.execution_state`
- **AND** SHALL overwrite any existing destination execution state without prompting

## Done When

All spec scenarios pass review. `skills/gauntlet-merge/SKILL.md` exists and is invocable as `/gauntlet-merge <branch>`. `skills/gauntlet-merge/merge-state.sh` exists and is executable. The script correctly handles the happy path and the branch-not-found error case.
