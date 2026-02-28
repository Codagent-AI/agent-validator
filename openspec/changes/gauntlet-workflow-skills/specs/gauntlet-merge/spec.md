## ADDED Requirements

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

---

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
