# agent-command Spec Delta

## ADDED Requirements

### Requirement: Fix PR Template Command

The system SHALL provide a `fix_pr.md` template command that instructs the agent to address review comments and CI failures on a pull request.

#### Scenario: Template prioritizes project-level instructions
- **GIVEN** the fix-pr template command is invoked
- **WHEN** the agent reads the instructions
- **THEN** it SHALL first look for project-level instructions or skills for addressing PR feedback (e.g., a `/fix-pr` skill, `.claude/commands/fix-pr.md`)

#### Scenario: Template includes minimal fallback
- **GIVEN** the fix-pr template command is invoked
- **AND** no project-level fix-pr instructions are found
- **WHEN** the agent follows the template
- **THEN** it SHALL use minimal fallback steps: check CI status, read failure logs, fetch review comments, fix issues, and push

#### Scenario: Template installed during init
- **GIVEN** a user runs `agent-gauntlet init`
- **WHEN** the init command completes
- **THEN** `.gauntlet/fix_pr.md` SHALL be created from the template
