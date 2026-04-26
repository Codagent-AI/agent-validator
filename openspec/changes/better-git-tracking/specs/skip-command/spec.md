## MODIFIED Requirements

### Requirement: Skip CLI Command

The system MUST provide an `agent-validate skip` CLI subcommand that advances the execution state baseline to the current working tree state without running any verification gates. The command SHALL archive existing logs and write a new `.execution_state` file, producing the same post-run state as a successful `agent-validate run`. Additionally, the command SHALL write a trusted ledger record with `source: "manual-skip"`. The ledger write is the skip command's own responsibility (not part of the run-completion flow). On a clean tree, the record SHALL use `commit: HEAD`, `tree: HEAD^{tree}`. On a dirty tree, the record SHALL use `commit: null`, `tree: <full snapshot tree>`, `working_tree_ref: <stash SHA>`.

#### Scenario: Skip with no existing state
- **WHEN** the user executes `agent-validate skip`
- **AND** no `.execution_state` file exists in the log directory
- **THEN** the command SHALL create the log directory if it does not exist
- **AND** the command SHALL write a new `.execution_state` file with the current branch, commit SHA, and working tree ref
- **AND** the command SHALL write a trusted ledger record with `source: "manual-skip"`
- **AND** the command SHALL exit with code 0

#### Scenario: Skip with existing state and logs
- **WHEN** the user executes `agent-validate skip`
- **AND** an `.execution_state` file and log files exist in the log directory
- **THEN** the command SHALL archive existing logs via the log clean process
- **AND** the command SHALL overwrite `.execution_state` with the current branch, commit SHA, and working tree ref
- **AND** the command SHALL write a trusted ledger record with `source: "manual-skip"`
- **AND** the command SHALL exit with code 0

#### Scenario: Skip on clean tree writes commit-keyed record
- **WHEN** the user executes `agent-validate skip`
- **AND** `git status --porcelain` returns empty
- **THEN** the ledger record SHALL have `commit: HEAD`, `tree: HEAD^{tree}`, `trusted: true`, `source: "manual-skip"`

#### Scenario: Skip on dirty tree writes tree-keyed record
- **WHEN** the user executes `agent-validate skip`
- **AND** `git status --porcelain` returns non-empty
- **THEN** the ledger record SHALL have `commit: null`, `tree: <full snapshot tree>`, `working_tree_ref: <stash SHA>`, `trusted: true`, `source: "manual-skip"`
- **AND** the full snapshot tree SHALL include untracked files captured by the stash `^3` parent when present

#### Scenario: Skip preserves unhealthy adapter state
- **WHEN** the user executes `agent-validate skip`
- **AND** the existing `.execution_state` contains `unhealthy_adapters` entries
- **THEN** the `unhealthy_adapters` entries SHALL be preserved in the updated `.execution_state`

#### Scenario: Skip console output
- **WHEN** the user executes `agent-validate skip`
- **AND** the command completes successfully
- **THEN** the command SHALL print a confirmation message that includes the abbreviated commit SHA

#### Scenario: Skip while another validator process holds the lock
- **WHEN** the user executes `agent-validate skip`
- **AND** another validator process holds the run lock
- **THEN** the command SHALL exit with a non-zero exit code
- **AND** the command SHALL print an error message indicating a run is already in progress
- **AND** the command SHALL NOT modify `.execution_state` or archive logs
- **AND** the command SHALL NOT write a ledger record

#### Scenario: Skip in a non-git directory
- **WHEN** the user executes `agent-validate skip`
- **AND** the current directory is not inside a git repository
- **THEN** the command SHALL exit with a non-zero exit code
- **AND** the command SHALL print an error message
- **AND** the command SHALL NOT write a ledger record

#### Scenario: Skip ledger write failure does not fail the command
- **WHEN** the user executes `agent-validate skip`
- **AND** the ledger write encounters an error
- **THEN** `.execution_state` SHALL still be updated
- **AND** the error SHALL be logged
- **AND** the command SHALL exit with code 0

### Requirement: Skip Skill

The system MUST provide a `/validator-skip` skill that invokes the `agent-validate skip` CLI command and reports the result.

#### Scenario: Skill invocation
- **WHEN** a user or agent invokes `/validator-skip`
- **THEN** the skill SHALL execute `agent-validate skip`
- **AND** the skill SHALL report the command output to the user
