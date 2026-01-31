# stop-hook Spec Delta

## MODIFIED Requirements

### Requirement: Unified Status Type

The system MUST use a single `GauntletStatus` type for all gauntlet outcomes, shared between the run executor and stop-hook.

#### Scenario: Direct status usage
- **GIVEN** executeRun returns a RunResult with status
- **WHEN** the stop-hook processes the result
- **THEN** it SHALL use the `GauntletStatus` value directly in the hook response
- **AND** it SHALL NOT map or translate the status to a different value
- **AND** the same status type is used by both executor and hook response

#### Scenario: No status mapping
- **GIVEN** the executor returns a `GauntletStatus` value
- **WHEN** the stop-hook builds its response
- **THEN** it SHALL use that exact status value in the hook response
- **AND** no mapping function SHALL exist between different status types

#### Scenario: Blocking determination
- **GIVEN** a `GauntletStatus` value is received
- **WHEN** the stop-hook determines the hook decision
- **THEN** it SHALL use a shared `isBlockingStatus()` helper
- **AND** `"failed"` and `"pr_push_required"` statuses SHALL result in a block decision

## ADDED Requirements

### Requirement: Auto Push PR Configuration

The stop hook SHALL support an `auto_push_pr` boolean setting that controls whether the agent is instructed to create or update a PR after all local gates pass.

#### Scenario: Setting defaults to false
- **GIVEN** no `auto_push_pr` setting is configured at any level
- **WHEN** the stop hook resolves configuration
- **THEN** `auto_push_pr` SHALL default to `false`

#### Scenario: Environment variable override
- **GIVEN** `GAUNTLET_AUTO_PUSH_PR` environment variable is set to `"true"` or `"1"`
- **WHEN** the stop hook resolves configuration
- **THEN** `auto_push_pr` SHALL be `true` regardless of project or global config

#### Scenario: Project config override
- **GIVEN** `.gauntlet/config.yml` contains `stop_hook.auto_push_pr: true`
- **AND** no `GAUNTLET_AUTO_PUSH_PR` environment variable is set
- **WHEN** the stop hook resolves configuration
- **THEN** `auto_push_pr` SHALL be `true`

#### Scenario: Three-tier precedence
- **GIVEN** `GAUNTLET_AUTO_PUSH_PR` is set to `"false"`
- **AND** project config has `stop_hook.auto_push_pr: true`
- **WHEN** the stop hook resolves configuration
- **THEN** `auto_push_pr` SHALL be `false` (env var wins)

### Requirement: PR Push Required Status

The system SHALL include a `pr_push_required` status in the `GauntletStatus` type that indicates local gates passed and a PR needs to be created or updated.

#### Scenario: Status blocks the stop
- **GIVEN** the stop hook determines status is `pr_push_required`
- **WHEN** `isBlockingStatus()` is called
- **THEN** it SHALL return `true`

#### Scenario: Status message
- **GIVEN** the status is `pr_push_required`
- **WHEN** the status message is generated
- **THEN** it SHALL indicate that gates passed and a PR needs to be created or updated

### Requirement: Post-Gauntlet PR Detection

When `auto_push_pr` is enabled and the gauntlet returns a success status, the stop hook SHALL check whether a PR exists and is up to date for the current branch before deciding to block. PR detection SHALL only be triggered by direct gauntlet success statuses (`passed`, `passed_with_warnings`), not by termination statuses or other approval statuses.

#### Scenario: No PR exists after gates pass
- **GIVEN** `auto_push_pr` is `true`
- **AND** the gauntlet returns `passed` or `passed_with_warnings`
- **AND** no open PR exists for the current branch
- **WHEN** the stop hook processes the result
- **THEN** it SHALL block with `pr_push_required` status
- **AND** the `reason` field SHALL contain instructions for creating or updating a PR

#### Scenario: PR exists but is not up to date
- **GIVEN** `auto_push_pr` is `true`
- **AND** the gauntlet returns `passed` or `passed_with_warnings`
- **AND** an open PR exists for the current branch
- **AND** the PR head SHA does not match the local HEAD SHA (unpushed commits exist)
- **WHEN** the stop hook processes the result
- **THEN** it SHALL block with `pr_push_required` status
- **AND** the `reason` field SHALL contain instructions for creating or updating a PR

#### Scenario: PR exists and is up to date
- **GIVEN** `auto_push_pr` is `true`
- **AND** the gauntlet returns `passed` or `passed_with_warnings`
- **AND** an open PR exists for the current branch
- **AND** the PR head SHA matches the local HEAD SHA
- **WHEN** the stop hook processes the result
- **THEN** it SHALL approve the stop with the original gauntlet status

#### Scenario: auto_push_pr is disabled
- **GIVEN** `auto_push_pr` is `false`
- **AND** the gauntlet returns a success status
- **WHEN** the stop hook processes the result
- **THEN** it SHALL approve the stop with the original gauntlet status (unchanged behavior)

#### Scenario: Termination statuses do not trigger PR detection
- **GIVEN** `auto_push_pr` is `true`
- **AND** the gauntlet returns a termination status (e.g., `termination_passed`, `termination_warnings`, `termination_retry_limit`)
- **WHEN** the stop hook processes the result
- **THEN** it SHALL NOT check for PR existence
- **AND** it SHALL approve the stop with the original gauntlet status

#### Scenario: gh CLI not available
- **GIVEN** `auto_push_pr` is `true`
- **AND** the gauntlet returns a success status
- **AND** the `gh` CLI is not installed
- **WHEN** the stop hook attempts to check for a PR
- **THEN** it SHALL log a warning
- **AND** it SHALL approve the stop with the original gauntlet status (graceful degradation)

#### Scenario: PR detection fails due to gh error
- **GIVEN** `auto_push_pr` is `true`
- **AND** the gauntlet returns a success status
- **AND** `gh pr view` fails for a reason other than missing CLI (e.g., network failure, auth failure, no remote tracking branch)
- **WHEN** the stop hook attempts to check for a PR
- **THEN** it SHALL log a warning with the error details
- **AND** it SHALL approve the stop with the original gauntlet status (graceful degradation)

### Requirement: Push PR Instructions

When blocking with `pr_push_required` status, the `reason` prompt SHALL instruct the agent to create or update a PR using project-level instructions when available, with minimal fallback instructions.

#### Scenario: Instructions prioritize project-level skills
- **GIVEN** the stop hook blocks with `pr_push_required`
- **WHEN** the `reason` prompt is generated
- **THEN** it SHALL instruct the agent to first look for project-level commit/PR instructions (e.g., `/push-pr` skill, `.claude/commands/push-pr.md`, `.gauntlet/push_pr.md`, CONTRIBUTING.md)

#### Scenario: Instructions include minimal fallback
- **GIVEN** the stop hook blocks with `pr_push_required`
- **WHEN** the `reason` prompt is generated
- **THEN** it SHALL include minimal fallback instructions for git add, commit, push, and `gh pr create`
- **AND** `gh` availability is a prerequisite for the fallback instructions

#### Scenario: Skipped issues included in PR description guidance
- **GIVEN** the gauntlet status is `passed_with_warnings`
- **AND** the stop hook blocks with `pr_push_required`
- **WHEN** the `reason` prompt is generated
- **THEN** it SHALL instruct the agent to include skipped issues in the PR description

#### Scenario: Instructions tell agent to stop after PR creation
- **GIVEN** the stop hook blocks with `pr_push_required`
- **WHEN** the `reason` prompt is generated
- **THEN** it SHALL instruct the agent to try stopping again after creating or updating the PR
