# agent-command Spec Delta

## ADDED Requirements

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
