# working-tree-ref-e2e Specification

## Purpose

End-to-end integration tests for the working tree reference lifecycle. These tests validate that `createWorkingTreeRef`, `getFixBaseDiff`, and `computeFixBaseDiffStats` work together correctly across all stash scenarios in a real git repository environment.

## Requirements

### Requirement: End-to-End Working Tree Ref Lifecycle Tests

The system MUST have end-to-end integration tests that exercise the full working-tree-ref lifecycle against real git repositories. These tests validate that `createWorkingTreeRef`, `getFixBaseDiff`, and `computeFixBaseDiffStats` work together correctly across all stash scenarios.

#### Scenario: Tracked-only changes produce valid stash ref
- **WHEN** a validator run completes in a repo with only tracked file modifications
- **THEN** the `.execution_state` file SHALL contain a `working_tree_ref` that differs from the HEAD commit SHA
- **AND** `git cat-file -t <working_tree_ref>` SHALL return "commit"
- **AND** the stash SHALL have 3 parents (proper stash structure)

#### Scenario: Tracked and untracked changes produce stash with ^3 parent
- **WHEN** a validator run completes in a repo with both tracked modifications and new untracked files
- **THEN** `working_tree_ref` SHALL reference a 3-parent stash
- **AND** `git ls-tree -r --name-only <working_tree_ref>^3` SHALL list the untracked files

#### Scenario: Clean working tree uses HEAD SHA
- **WHEN** a validator run completes in a repo with a clean working tree (all changes committed)
- **THEN** `working_tree_ref` SHALL equal the HEAD commit SHA

#### Scenario: Untracked file committed before next diff produces no spurious changes
- **GIVEN** a validator run completed with an untracked file captured in `working_tree_ref`'s `^3` parent
- **AND** the untracked file has since been committed without content changes
- **WHEN** the next validator run computes the diff against `working_tree_ref`
- **THEN** the committed file SHALL NOT appear in the diff output
- **AND** the diff file count SHALL NOT include the committed file

#### Scenario: Only genuinely new changes appear in subsequent diff
- **GIVEN** a validator run completed and captured `working_tree_ref`
- **AND** new files have been created or existing files modified since then
- **WHEN** the next validator run computes the diff
- **THEN** only the genuinely new changes SHALL appear in the diff
- **AND** files that were already captured in the previous stash (in any tree) SHALL NOT appear
