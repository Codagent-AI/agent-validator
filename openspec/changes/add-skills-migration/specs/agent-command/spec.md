## ADDED Requirements

### Requirement: Skill Directory Structure
The system SHALL store canonical skill files under `.gauntlet/skills/gauntlet/<action>/SKILL.md` using nested directories to achieve colon-namespaced invocation (e.g., `/gauntlet:run`).

#### Scenario: Canonical skill files created during init
- **WHEN** `agent-gauntlet init` creates the gauntlet configuration
- **THEN** skill directories SHALL be created under `.gauntlet/skills/gauntlet/` for each action: `run`, `check`, `push-pr`, `fix-pr`, `status`
- **AND** each directory SHALL contain a `SKILL.md` file with YAML frontmatter

#### Scenario: Skill frontmatter format
- **WHEN** a skill `SKILL.md` file is created
- **THEN** it SHALL contain YAML frontmatter with `name`, `description`, and `allowed-tools` fields
- **AND** action skills (`run`, `check`, `push-pr`, `fix-pr`) SHALL set `disable-model-invocation: true`
- **AND** informational skills (`status`) SHALL allow model invocation

#### Scenario: Colon-namespaced invocation
- **GIVEN** a skill at `.claude/skills/gauntlet/run/SKILL.md`
- **WHEN** the user types `/gauntlet:run`
- **THEN** Claude Code SHALL invoke the skill from the nested `gauntlet/run/` directory

### Requirement: Skill Installation for Claude
The init command SHALL install skills into `.claude/skills/gauntlet/` for Claude Code using symlinks when possible.

#### Scenario: Project-level Claude skill installation
- **GIVEN** a user selects project-level installation during init
- **AND** Claude is a selected agent
- **WHEN** skills are installed
- **THEN** skill directories SHALL be created under `.claude/skills/gauntlet/<action>/` for each skill
- **AND** each `SKILL.md` SHALL be a symlink to the corresponding `.gauntlet/skills/gauntlet/<action>/SKILL.md`

#### Scenario: User-level Claude skill installation
- **GIVEN** a user selects user-level installation during init
- **AND** Claude is a selected agent
- **WHEN** skills are installed
- **THEN** skill files SHALL be written (not symlinked) to `~/.claude/skills/gauntlet/<action>/SKILL.md`

### Requirement: Command Installation for Non-Claude Agents
The init command SHALL continue installing flat command files for agents that do not support the skills directory model.

#### Scenario: Gemini command installation
- **GIVEN** a user selects Gemini as an agent during init
- **WHEN** commands are installed
- **THEN** flat command files SHALL be created in the Gemini command directory

#### Scenario: Codex command installation
- **GIVEN** a user selects Codex as an agent during init
- **WHEN** commands are installed
- **THEN** flat command files SHALL be created in the Codex command directory

### Requirement: Check Skill
The system SHALL provide a `/gauntlet:check` skill that runs only check gates (no reviews), following the same iterative fix workflow as `/gauntlet:run`.

#### Scenario: Check skill runs checks only
- **WHEN** the agent invokes `/gauntlet:check`
- **THEN** the skill SHALL instruct the agent to run `agent-gauntlet check`
- **AND** the fix-and-rerun loop SHALL follow the same pattern as `/gauntlet:run`

#### Scenario: Check skill installed during init
- **GIVEN** a user runs `agent-gauntlet init`
- **WHEN** skills are installed
- **THEN** the `gauntlet/check` skill SHALL be included in the installed skills

### Requirement: Status Skill
The system SHALL provide a `/gauntlet:status` skill that summarizes the most recent gauntlet session from log files.

#### Scenario: Status from active logs
- **WHEN** the agent invokes `/gauntlet:status`
- **AND** `gauntlet_logs/` contains active log files
- **THEN** the skill SHALL run its bundled script to parse the logs
- **AND** produce a summary including: iteration count, overall status, failures fixed/skipped/outstanding, and per-iteration change statistics

#### Scenario: Status from previous logs
- **WHEN** the agent invokes `/gauntlet:status`
- **AND** `gauntlet_logs/` has no active logs but `gauntlet_logs/previous/` contains archived logs
- **THEN** the skill SHALL parse the previous session's logs and indicate they are from an archived session

#### Scenario: No logs available
- **WHEN** the agent invokes `/gauntlet:status`
- **AND** neither `gauntlet_logs/` nor `gauntlet_logs/previous/` contain log files
- **THEN** the skill SHALL report that no gauntlet session data is available

#### Scenario: Status skill bundled script
- **GIVEN** the `gauntlet/status` skill directory
- **THEN** it SHALL contain a `scripts/status.ts` script
- **AND** the SKILL.md SHALL instruct the agent to run the script via `bun`
- **AND** the script SHALL parse console logs, debug logs, and review JSON files

#### Scenario: Status summary content
- **WHEN** the status script produces output
- **THEN** the summary SHALL include:
  - Number of iterations (runs) in the session
  - Overall session status (passed, failed, retry limit exceeded, in progress)
  - Per-iteration: files changed, lines added/removed, gates run, pass/fail counts
  - Violations fixed, skipped, and outstanding across all iterations
  - Gate-level results (which specific checks/reviews passed or failed)

### Requirement: Skill Naming Convention
All gauntlet skills SHALL use a nested `gauntlet/<action>/` directory structure to achieve `/gauntlet:<action>` colon-namespaced invocation.

#### Scenario: Skill name format
- **WHEN** a gauntlet skill is registered
- **THEN** its directory structure SHALL be `gauntlet/<action>/SKILL.md` (e.g., `gauntlet/run/SKILL.md`, `gauntlet/check/SKILL.md`, `gauntlet/status/SKILL.md`)
- **AND** the `name` field in frontmatter SHALL be the action name only (e.g., `run`, `check`, `status`)

## MODIFIED Requirements

### Requirement: Push PR Template Command

The system SHALL provide a `/gauntlet:push-pr` skill (migrated from `push_pr.md`) that instructs the agent to commit changes and create or update a pull request.

#### Scenario: Template prioritizes project-level instructions
- **GIVEN** the `/gauntlet:push-pr` skill is invoked
- **WHEN** the agent reads the instructions
- **THEN** it SHALL first look for project-level commit/PR instructions or skills (e.g., a `/commit` command, `/push-pr` skill, project CONTRIBUTING.md)

#### Scenario: Template includes minimal fallback
- **GIVEN** the `/gauntlet:push-pr` skill is invoked
- **AND** no project-level commit/PR instructions are found
- **WHEN** the agent follows the template
- **THEN** it SHALL use the minimal fallback steps: stage changes, commit with descriptive message, push to remote, and create PR via `gh pr create`

#### Scenario: Skill installed during init
- **GIVEN** a user runs `agent-gauntlet init`
- **WHEN** the init command completes
- **THEN** `.gauntlet/skills/gauntlet/push-pr/SKILL.md` SHALL be created from the template

### Requirement: Fix PR Template Command

The system SHALL provide a `/gauntlet:fix-pr` skill (migrated from `fix_pr.md`) that instructs the agent to address review comments and CI failures on a pull request.

#### Scenario: Template prioritizes project-level instructions
- **GIVEN** the `/gauntlet:fix-pr` skill is invoked
- **WHEN** the agent reads the instructions
- **THEN** it SHALL first look for project-level instructions or skills for addressing PR feedback

#### Scenario: Template includes minimal fallback
- **GIVEN** the `/gauntlet:fix-pr` skill is invoked
- **AND** no project-level fix-pr instructions are found
- **WHEN** the agent follows the template
- **THEN** it SHALL use minimal fallback steps: check CI status, read failure logs, fetch review comments, fix issues, and push

#### Scenario: Skill installed during init
- **GIVEN** a user runs `agent-gauntlet init`
- **WHEN** the init command completes
- **THEN** `.gauntlet/skills/gauntlet/fix-pr/SKILL.md` SHALL be created from the template
