## MODIFIED Requirements

### Requirement: Issue Output Path Instructions
The command template SHALL instruct the agent to infer the log directory from console output paths and delegate file reading to a subagent, rather than reading log and JSON files directly.

#### Scenario: Check failure output
- **GIVEN** the gauntlet run command has exited with a non-zero code
- **WHEN** a check gate failure appears in the console output
- **THEN** the console output includes the log file path
- **AND** the template instructs the agent to pass the log directory path to an EXTRACT subagent that reads the log file and returns a compact error summary

#### Scenario: Review failure output
- **GIVEN** the gauntlet run command has exited with a non-zero code
- **WHEN** a review gate failure appears in the console output
- **THEN** the console output includes the JSON result file path
- **AND** the template instructs the agent to pass the log directory path to an EXTRACT subagent that reads the JSON file and returns a compact violation summary

#### Scenario: Log directory inference
- **GIVEN** the gauntlet run command has produced console output
- **WHEN** the output contains file paths referencing log or JSON files
- **THEN** the agent SHALL infer the log directory from the path prefix of any referenced log or JSON file
- **AND** pass the inferred directory to subagents rather than hardcoding a log directory path

### Requirement: Issue Status Updates
The command template SHALL instruct the agent to delegate status updates in review JSON files to an UPDATE subagent, passing fix/skip decisions as input.

#### Scenario: Agent fixes an issue
- **GIVEN** the EXTRACT subagent has returned a violation summary
- **WHEN** the agent successfully fixes a reported violation
- **THEN** the agent passes the decision (status `"fixed"` and a brief result description) to an UPDATE subagent
- **AND** the UPDATE subagent updates the violation's `status` and `result` fields in the JSON file

#### Scenario: Agent skips an issue
- **GIVEN** the EXTRACT subagent has returned a violation summary
- **WHEN** the agent decides to skip a reported violation
- **THEN** the agent passes the decision (status `"skipped"` and a brief reason) to an UPDATE subagent
- **AND** the UPDATE subagent updates the violation's `status` and `result` fields in the JSON file

#### Scenario: Agent preserves other attributes
- **GIVEN** the agent has passed fix/skip decisions to the UPDATE subagent
- **WHEN** the UPDATE subagent updates a violation's status in the JSON file
- **THEN** it SHALL NOT modify other attributes such as `file`, `line`, `issue`, `fix`, or `priority`

## ADDED Requirements

### Requirement: Subagent Delegation Pattern
The gauntlet-run skill SHALL use a two-phase subagent delegation pattern to keep the main agent's context window free of log and JSON file contents. All log and JSON file access SHALL be performed via subagent Task calls.

#### Scenario: EXTRACT subagent reads failures
- **GIVEN** the gauntlet run command has exited with a non-zero code
- **WHEN** the agent detects the failure
- **THEN** the agent SHALL spawn a synchronous EXTRACT subagent (Task tool, general-purpose, cost-optimized model) with the log directory path
- **AND** the EXTRACT subagent SHALL find the highest-numbered `console.N.log`, identify `[FAIL]` lines, read the referenced log and JSON files, and return a compact plain-text summary

#### Scenario: EXTRACT subagent extracts check errors
- **GIVEN** the EXTRACT subagent has identified a failed check gate from the console log
- **WHEN** the EXTRACT subagent reads the check gate log file
- **THEN** it SHALL extract error output, any `--- Fix Instructions ---` section content, and any `--- Fix Skill: <name> ---` section references

#### Scenario: EXTRACT subagent extracts review violations
- **GIVEN** the EXTRACT subagent has identified a failed review gate from the console log
- **WHEN** the EXTRACT subagent reads the review gate JSON file
- **THEN** it SHALL extract violations with status `"new"` and return each violation's file, line, issue summary, priority, and fix suggestion

#### Scenario: UPDATE subagent writes decisions
- **GIVEN** the agent has completed fixing code and determined fix/skip decisions for review violations
- **WHEN** the agent is ready to record its decisions
- **THEN** the agent SHALL spawn a synchronous UPDATE subagent (Task tool, general-purpose, cost-optimized model) with the log directory path and the list of decisions
- **AND** the UPDATE subagent SHALL match violations by exact equality on `file` and `line` fields and by prefix match on the `issue` field, then update `status` and `result` fields

### Requirement: Subagent Safety Constraint
The gauntlet-run skill SHALL explicitly prohibit background subagent execution to prevent context pollution from the TaskOutput truncation bug.

#### Scenario: Synchronous subagent calls only
- **GIVEN** the gauntlet-run skill template contains subagent dispatch instructions
- **WHEN** the agent reads the skill instructions
- **THEN** the template SHALL include an explicit warning that `run_in_background: true` MUST NOT be used
- **AND** all subagent Task calls SHALL be synchronous (blocking)

### Requirement: Subagent Prompt Template Files
The gauntlet-run skill SHALL include separate prompt template files for each subagent role, generated alongside SKILL.md during init.

#### Scenario: Prompt files generated during init
- **GIVEN** a user runs `agent-validator init`
- **WHEN** the init command generates the gauntlet-run skill
- **THEN** it SHALL create three files: `SKILL.md`, `extract-prompt.md`, and `update-prompt.md` in the gauntlet-run skill directory

#### Scenario: SKILL.md references prompt templates
- **GIVEN** the gauntlet-run skill has been installed
- **WHEN** the agent reads the gauntlet-run SKILL.md
- **THEN** it SHALL find instructions to read `extract-prompt.md` and `update-prompt.md` from the same directory and use their content as subagent prompts

### Requirement: Gauntlet-Run Skill Allowed Tools
The gauntlet-run skill SHALL declare both `Bash` and `Task` in its `allowed-tools` frontmatter to enable subagent delegation.

#### Scenario: Allowed tools include Task
- **GIVEN** `agent-validator init` generates the gauntlet-run skill
- **WHEN** the skill frontmatter is written
- **THEN** the `allowed-tools` field SHALL include both `Bash` and `Task`
