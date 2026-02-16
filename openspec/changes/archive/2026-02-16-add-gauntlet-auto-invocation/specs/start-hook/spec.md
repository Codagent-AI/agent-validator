## ADDED Requirements

### Requirement: Start Hook Command

The system SHALL provide an `agent-gauntlet start-hook` CLI command that outputs context injection to prime agents with gauntlet verification instructions at session start. The output format is protocol-specific (JSON for Claude Code, plain text for Cursor).

#### Scenario: Gauntlet project detected
- **GIVEN** the current working directory has `.gauntlet/config.yml`
- **WHEN** the `start-hook` command runs
- **THEN** it SHALL output context injection with instructions telling the agent to run `/gauntlet-run` before reporting coding tasks as complete

#### Scenario: Non-gauntlet project
- **GIVEN** the current working directory has no `.gauntlet/config.yml`
- **WHEN** the `start-hook` command runs
- **THEN** it SHALL exit 0 with no output (silent no-op)

#### Scenario: Malformed gauntlet config
- **GIVEN** the current working directory has a `.gauntlet/config.yml` that is empty or contains invalid YAML
- **WHEN** the `start-hook` command runs
- **THEN** it SHALL exit 0 with no output (treat as non-gauntlet project)

### Requirement: Start Hook Context Message

The context injection message SHALL provide clear rules for when the agent should and should not invoke `/gauntlet-run`.

#### Scenario: Message includes invocation conditions
- **GIVEN** the start-hook outputs context
- **WHEN** the agent reads the instructions
- **THEN** the message SHALL instruct the agent to run `/gauntlet-run` when it has completed a coding task and is about to report work as done

#### Scenario: Message includes exclusion conditions
- **GIVEN** the start-hook outputs context
- **WHEN** the agent reads the instructions
- **THEN** the message SHALL instruct the agent NOT to run `/gauntlet-run` for read-only tasks (questions, exploration, read-only commands)
- **AND** NOT during the middle of multi-step tasks
- **AND** NOT when the user explicitly asks to skip verification

#### Scenario: Message favors false positives over false negatives
- **GIVEN** the start-hook outputs context
- **WHEN** the agent reads the instructions
- **THEN** the message SHALL instruct the agent that when unsure, it should run `/gauntlet-run` (false positives are less costly than false negatives)

#### Scenario: Message uses priority emphasis
- **GIVEN** the start-hook outputs context
- **WHEN** the message is generated
- **THEN** the message SHALL be wrapped in `<IMPORTANT>` tags to ensure the instructions receive high attention priority in the agent's context window

### Requirement: Start Hook Protocol Support

The start-hook command SHALL select the output protocol from the `--adapter` flag. The flag accepts `claude` or `cursor` values. If the flag is missing or contains an unrecognized value, the command SHALL default to the `claude` JSON format.

#### Scenario: Claude Code SessionStart output format
- **GIVEN** the start-hook is invoked with `--adapter claude`
- **WHEN** it outputs context injection
- **THEN** the output SHALL be valid JSON following the format: `{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "<message>" } }`

#### Scenario: Cursor sessionStart output format
- **GIVEN** the start-hook is invoked with `--adapter cursor`
- **WHEN** it outputs context injection
- **THEN** the output SHALL be the plain text context message written directly to stdout (not wrapped in JSON)

#### Scenario: Unknown or missing adapter flag
- **GIVEN** the start-hook is invoked without the `--adapter` flag or with an unrecognized value
- **WHEN** it determines the output format
- **THEN** it SHALL default to the Claude Code JSON format

### Requirement: Start Hook Simplicity

The start-hook command SHALL be a simple, stateless context injector with no stdin parsing, recursion guards, or marker files.

#### Scenario: No stdin required
- **GIVEN** the start-hook command is invoked
- **WHEN** it runs
- **THEN** it SHALL NOT read from stdin
- **AND** it SHALL NOT require any JSON input

#### Scenario: Always exits zero
- **GIVEN** the start-hook command is invoked
- **WHEN** it completes (whether gauntlet project or not, whether config is valid or malformed)
- **THEN** it SHALL exit with code 0
