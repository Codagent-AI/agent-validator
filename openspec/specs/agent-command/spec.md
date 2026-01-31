# agent-command Specification

## Purpose
TBD - created by archiving change add-review-trust-setting. Update Purpose after archive.
## Requirements
### Requirement: Trust Level Configuration
The `/gauntlet` command template SHALL include configurable trust level guidance that controls the agent's threshold for acting on AI reviewer feedback.

#### Scenario: Default trust level
- **WHEN** `agent-gauntlet init` creates the command template
- **THEN** the template uses medium trust level by default

#### Scenario: User customizes trust level
- **WHEN** a user edits their project's command template to use a different trust level
- **THEN** the agent follows the trust level guidance specified in the template

### Requirement: Trust Level Guidance Text
The command template SHALL include clear guidance text for each trust level that instructs the agent on when to fix vs. skip reported issues.

#### Scenario: High trust behavior
- **WHEN** the template specifies high trust
- **THEN** the prompt instructs the agent to fix all reported issues unless there is strong disagreement or low confidence that the human wants the change

#### Scenario: Medium trust behavior
- **WHEN** the template specifies medium trust (default)
- **THEN** the prompt instructs the agent to fix issues it reasonably agrees with or believes the human wants fixed

#### Scenario: Low trust behavior
- **WHEN** the template specifies low trust
- **THEN** the prompt instructs the agent to fix only issues it strongly agrees with or is confident the human wants fixed

### Requirement: Trust Level Documentation
The command template SHALL include comments explaining the available trust levels and how to switch between them.

#### Scenario: Comments explain options
- **WHEN** a user views the command template file
- **THEN** comments at the top of the file explain high, medium, and low trust options
- **AND** show which lines to modify to change the trust level

### Requirement: Report Unfixed Issues
When the agent skips fixing an issue due to trust level threshold, it SHALL still report the issue rather than silently ignoring it.

#### Scenario: Issue skipped due to trust threshold
- **WHEN** the agent decides not to fix an issue based on trust level guidance
- **THEN** the agent notes the issue and its reasoning for not fixing it
- **AND** the agent may proceed to completion without the issue blocking progress

### Requirement: Issue Output Path Instructions
The command template SHALL instruct the agent to read the file paths from the script's console output to understand what files to examine.

#### Scenario: Check failure output
- **WHEN** a check gate fails
- **THEN** the console output includes the markdown log file path
- **AND** the template instructs the agent to read the log file at that path

#### Scenario: Review failure output
- **WHEN** a review gate fails
- **THEN** the console output includes the JSON result file path
- **AND** the template instructs the agent to read and update the JSON file at that path

### Requirement: Issue Status Updates
The command template SHALL instruct the agent to update status fields in review JSON files to track fix outcomes.

#### Scenario: Agent fixes an issue
- **WHEN** the agent successfully fixes a reported violation
- **THEN** the agent updates the violation's `status` to `"fixed"` in the JSON file
- **AND** the agent adds a `result` attribute with a brief description of the fix

#### Scenario: Agent skips an issue
- **WHEN** the agent decides to skip a reported violation
- **THEN** the agent updates the violation's `status` to `"skipped"` in the JSON file
- **AND** the agent adds a `result` attribute with a brief reason for skipping

#### Scenario: Agent preserves other attributes
- **WHEN** the agent updates a violation's status in the JSON file
- **THEN** the agent does not modify other attributes such as `file`, `line`, `issue`, `fix`, or `priority`

### Requirement: Retry Termination
The command template SHALL NOT include a hardcoded retry limit. Instead, the template SHALL instruct the agent to repeat the run/fix cycle until the script reports a terminal status. The termination conditions SHALL be: "Passed", "Passed with warnings", or "Retry limit exceeded". When "Retry limit exceeded" is reported, the template SHALL instruct the agent to run `agent-gauntlet clean` to archive logs and include any unverified fixes in the session summary.

#### Scenario: Template termination conditions
- **WHEN** a user views the command template's loop instructions
- **THEN** the termination conditions SHALL include "Passed", "Passed with warnings", and "Retry limit exceeded"
- **AND** the template SHALL NOT mention a specific number of attempts

#### Scenario: Script reports retry limit exceeded
- **WHEN** the script outputs "Status: Retry limit exceeded"
- **THEN** the agent SHALL stop retrying (no further fix attempts)
- **AND** the agent SHALL run `agent-gauntlet clean` to archive logs for the session record
- **AND** the agent SHALL NOT retry after cleaning (clean is for archival, not for resetting the retry count)
- **AND** the agent SHALL report any unverified fixes in its session summary under "Outstanding Failures"

### Requirement: Push PR Template Command

The system SHALL provide a `push_pr.md` template command that instructs the agent to commit changes and create or update a pull request.

#### Scenario: Template prioritizes project-level instructions
- **GIVEN** the push-pr template command is invoked
- **WHEN** the agent reads the instructions
- **THEN** it SHALL first look for project-level commit/PR instructions or skills (e.g., a `/commit` command, `/push-pr` skill, project CONTRIBUTING.md)

#### Scenario: Template includes minimal fallback
- **GIVEN** the push-pr template command is invoked
- **AND** no project-level commit/PR instructions are found
- **WHEN** the agent follows the template
- **THEN** it SHALL use the minimal fallback steps: stage changes, commit with descriptive message, push to remote, and create PR via `gh pr create`

#### Scenario: Template installed during init
- **GIVEN** a user runs `agent-gauntlet init`
- **WHEN** the init command completes
- **THEN** `.gauntlet/push_pr.md` SHALL be created from the template

