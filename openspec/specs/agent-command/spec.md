# agent-command Specification

## Purpose
Specifies the agent-facing skill templates and workflows for interacting with Agent Validator.

## Requirements
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
The command template SHALL NOT include a hardcoded retry limit. Instead, the template SHALL instruct the agent to repeat the run/fix cycle until the script reports a terminal status. The termination conditions SHALL be: "Passed", "Passed with warnings", or "Retry limit exceeded". When "Retry limit exceeded" is reported, the template SHALL instruct the agent to run `agent-validate clean` to archive logs and include any unverified fixes in the session summary.

#### Scenario: Template termination conditions
- **WHEN** a user views the command template's loop instructions
- **THEN** the termination conditions SHALL include "Passed", "Passed with warnings", and "Retry limit exceeded"
- **AND** the template SHALL NOT mention a specific number of attempts

#### Scenario: Script reports retry limit exceeded
- **WHEN** the script outputs "Status: Retry limit exceeded"
- **THEN** the agent SHALL stop retrying (no further fix attempts)
- **AND** the agent SHALL run `agent-validate clean` to archive logs for the session record
- **AND** the agent SHALL NOT retry after cleaning (clean is for archival, not for resetting the retry count)
- **AND** the agent SHALL report any unverified fixes in its session summary under "Outstanding Failures"

### Requirement: Gauntlet Help Diagnostic Skill
The system SHALL provide a `/validator-help` skill for evidence-based diagnosis of gauntlet behavior. The skill SHALL be diagnosis-only (no auto-fix behavior) and SHALL operate without requiring source code access. After completing a diagnosis, the skill SHALL route to bug filing based on confidence level: automatically invoking `validator-issue` on high-confidence bug diagnoses, prompting the user on medium confidence, and taking no action on low confidence.

#### Scenario: Diagnose a "no changes" question from runtime evidence
- **GIVEN** a user asks "/validator-help: the hook reported no changes, why?"
- **WHEN** the skill investigates
- **THEN** it SHALL resolve `log_dir` from `.validator/config.yml`
- **AND** inspect runtime evidence from `<log_dir>/.debug.log`, `<log_dir>/.execution_state`, and relevant gate/review logs
- **AND** return a structured response including Diagnosis, Evidence, Confidence (`high`/`medium`/`low`), and Next steps

#### Scenario: High-confidence bug diagnosis

- **WHEN** the skill completes a diagnosis with confidence level High
- **AND** the diagnosis indicates a likely bug in agent-validator (not a configuration or user error)
- **THEN** the skill SHALL automatically invoke `validator-issue`
- **AND** SHALL pass the diagnosis summary as the bug description

#### Scenario: High-confidence non-bug diagnosis

- **WHEN** the skill completes a diagnosis with confidence level High
- **AND** the diagnosis indicates a configuration issue, user error, or expected behavior
- **THEN** the skill SHALL NOT invoke `validator-issue`

#### Scenario: Medium-confidence possible bug

- **WHEN** the skill completes a diagnosis with confidence level Medium
- **AND** the evidence suggests a possible gauntlet bug
- **THEN** the skill SHALL ask the user: "This may be a gauntlet bug. Want me to file a GitHub issue?"
- **AND** if the user confirms, SHALL invoke `validator-issue` with the diagnosis as the bug description
- **AND** if the user declines, SHALL exit without filing

#### Scenario: Low-confidence diagnosis

- **WHEN** the skill completes a diagnosis with confidence level Low
- **THEN** the skill SHALL NOT prompt the user to file an issue
- **AND** SHALL NOT invoke `validator-issue`

### Requirement: Situation-Based Skill Structure
The `validator-help` skill SHALL use a multi-file structure with `SKILL.md` containing always-needed content (evidence sources, output contract, diagnostic workflow, routing logic) and situation-based reference files under `references/` organized by troubleshooting domain.

#### Scenario: Router selects only needed reference for a config question
- **GIVEN** the `validator-help` skill bundle is installed
- **WHEN** the user asks about a config validation error
- **THEN** `SKILL.md` SHALL route to `references/config-troubleshooting.md`

### Requirement: Comprehensive Diagnostic Playbooks
The `validator-help` skill SHALL provide situation-based troubleshooting references that cover config issues, gate failures, lock conflicts, and adapter health, and SHALL use dynamic evidence acquisition to gather only the additional signals needed for diagnosis.

#### Scenario: Explain gate failures with targeted evidence gathering
- **GIVEN** a user asks why a gate failed
- **WHEN** logs/state do not provide enough evidence for a confident explanation
- **THEN** the skill SHALL run one or more of `agent-validate list`, `agent-validate health`, and `agent-validate detect` as needed
- **AND** it SHALL explain the observed result using the relevant troubleshooting reference

### Requirement: Skill Directory Structure
The system SHALL store canonical skill files under `.validator/skills/validator-<action>/SKILL.md` using a flat directory structure with hyphenated naming to achieve `/validator-<action>` invocation.

#### Scenario: Canonical skill files created during init
- **WHEN** `agent-validate init` creates the gauntlet configuration
- **THEN** skill directories SHALL be created under `.validator/skills/` for each action: `validator-run`, `validator-check`, `validator-status`
- **AND** each directory SHALL contain a `SKILL.md` file with YAML frontmatter

#### Scenario: Skill frontmatter format
- **WHEN** a skill `SKILL.md` file is created
- **THEN** it SHALL contain YAML frontmatter with `name`, `description`, and `allowed-tools` fields
- **AND** non-auto-invoked gauntlet skills (`validator-check`, `validator-status`) SHALL set `disable-model-invocation: true`
- **AND** `validator-run` SHALL set `disable-model-invocation: false` for auto-invocation

#### Scenario: Hyphenated skill invocation
- **GIVEN** a skill at `.claude/skills/validator-run/SKILL.md`
- **WHEN** the user types `/validator-run`
- **THEN** Claude Code SHALL invoke the skill from the flat `validator-run/` directory

### Requirement: Skill Installation for Claude
The init command SHALL install skills into `.claude/skills/` for Claude Code by writing skill files directly via `installSkill`.

#### Scenario: Project-level Claude skill installation
- **GIVEN** a user selects project-level installation during init
- **AND** Claude is a selected agent
- **WHEN** skills are installed
- **THEN** skill directories SHALL be created under `.claude/skills/validator-<action>/` for each skill
- **AND** each `SKILL.md` SHALL be written directly (not symlinked) by the `installSkill` function

#### Scenario: User-level Claude skill installation
- **GIVEN** a user selects user-level installation during init
- **AND** Claude is a selected agent
- **WHEN** skills are installed
- **THEN** skill files SHALL be written directly to `~/.claude/skills/validator-<action>/SKILL.md`

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
The system SHALL provide a `/validator-check` skill that runs only check gates (no reviews), following the same iterative fix workflow as `/validator-run`.

#### Scenario: Check skill runs checks only
- **WHEN** the agent invokes `/validator-check`
- **THEN** the skill SHALL instruct the agent to run `agent-validate check`
- **AND** the fix-and-rerun loop SHALL follow the same pattern as `/validator-run`

#### Scenario: Check skill installed during init
- **GIVEN** a user runs `agent-validate init`
- **WHEN** skills are installed
- **THEN** the `validator-check` skill SHALL be included in the installed skills

### Requirement: Status Skill
The system SHALL provide a `/validator-status` skill that summarizes the most recent gauntlet session from log files.

#### Scenario: Status from active logs
- **WHEN** the agent invokes `/validator-status`
- **AND** `validator_logs/` contains active log files
- **THEN** the skill SHALL run its bundled script to parse the logs
- **AND** produce a summary including: iteration count, overall status, failures fixed/skipped/outstanding, and per-iteration change statistics

#### Scenario: Status from previous logs
- **WHEN** the agent invokes `/validator-status`
- **AND** `validator_logs/` has no active logs but `validator_logs/previous/` contains archived logs
- **THEN** the skill SHALL parse the previous session's logs and indicate they are from an archived session

#### Scenario: No logs available
- **WHEN** the agent invokes `/validator-status`
- **AND** neither `validator_logs/` nor `validator_logs/previous/` contain log files
- **THEN** the skill SHALL report that no gauntlet session data is available

#### Scenario: Status skill bundled script
- **GIVEN** the `validator-status` skill is installed
- **THEN** the shared status script SHALL be present at `.validator/scripts/status.ts`
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
All validator skills SHALL use a flat `validator-<action>/` directory structure with hyphenated naming to achieve `/validator-<action>` invocation.

#### Scenario: Skill name format
- **WHEN** a validator skill is registered
- **THEN** its directory structure SHALL be `validator-<action>/SKILL.md` (e.g., `validator-run/SKILL.md`, `validator-check/SKILL.md`, `validator-status/SKILL.md`)
- **AND** the `name` field in frontmatter SHALL be `validator-<action>` (e.g., `validator-run`, `validator-check`, `validator-status`)

### Requirement: Setup Skill Installation

The `init` command SHALL install the `/validator-setup` skill alongside existing skills (run, check, status, help). The setup skill SHALL be installed as a multi-file skill with a SKILL.md and a references directory.

#### Scenario: Setup skill installed during init
- **GIVEN** a user runs `agent-validate init`
- **AND** selects CLI agents that support skills
- **WHEN** skills are installed
- **THEN** the `validator-setup` skill SHALL be installed with `SKILL.md` and `references/check-catalog.md`

#### Scenario: Setup skill not overwritten
- **GIVEN** the `validator-setup` skill already exists
- **WHEN** `agent-validate init` runs
- **THEN** existing skill files SHALL NOT be overwritten, but any missing skill files SHALL be created

### Requirement: Setup Skill Fresh Configuration

The `/validator-setup` skill SHALL guide the agent through scanning a project, discovering available tooling, and configuring `entry_points` in `.validator/config.yml`. On fresh setup (empty `entry_points`), the skill performs a full project scan.

#### Scenario: Config file missing
- **GIVEN** `.validator/config.yml` does not exist
- **WHEN** the agent invokes `/validator-setup`
- **THEN** the agent SHALL inform the user to run `agent-validate init` first
- **AND** SHALL NOT proceed with scanning

#### Scenario: Fresh setup with discovered checks
- **GIVEN** `.validator/config.yml` exists with `entry_points: []`
- **WHEN** the agent invokes `/validator-setup`
- **THEN** the agent SHALL scan the project for tooling signals across 6 categories (build, lint, typecheck, test, security-deps, security-code)
- **AND** present a table of discovered checks with tool names, commands, and confidence levels
- **AND** ask the user to confirm which checks to enable

#### Scenario: Check YAML files created
- **GIVEN** the user confirms discovered checks
- **WHEN** the agent creates check configurations
- **THEN** individual `.validator/checks/<name>.yml` files SHALL be created for each confirmed check
- **AND** each file SHALL follow the check gate schema (command, parallel, run_in_ci, run_locally, etc.)

#### Scenario: Source directory determination
- **GIVEN** the user has confirmed which checks to enable
- **WHEN** the agent needs to set the `entry_points[].path` value
- **THEN** the agent SHALL ask the user for the source directory or infer it from project structure
- **AND** the agent SHALL skip this step when adding checks to an existing entry point that already has a path

#### Scenario: Entry points updated with checks and built-in review
- **GIVEN** the user confirms checks and source directory
- **WHEN** the agent updates `.validator/config.yml`
- **THEN** `entry_points` SHALL include the confirmed checks and the `code-quality` review
- **AND** the agent SHALL run `agent-validate validate` to verify the configuration

#### Scenario: Suggest next steps after successful setup
- **GIVEN** the agent has validated the configuration
- **WHEN** validation passes
- **THEN** the agent SHALL inform the user they can run `/validator-run`

#### Scenario: Validation fails after setup
- **GIVEN** the agent has created check files and updated config.yml
- **WHEN** `agent-validate validate` reports errors
- **THEN** the agent SHALL display the validation errors to the user
- **AND** apply one corrective update attempt based on the error messages
- **AND** rerun `agent-validate validate` once more
- **AND** if validation still fails, stop and ask the user for guidance

#### Scenario: User declines all discovered checks
- **GIVEN** the agent presents discovered checks to the user
- **WHEN** the user declines all of them
- **THEN** the agent SHALL offer the custom addition flow to manually specify checks or reviews
- **AND** the agent SHALL still include the `code-quality` review in `entry_points`

#### Scenario: No tools discovered during scan
- **GIVEN** `.validator/config.yml` exists with `entry_points: []`
- **WHEN** the agent scans the project and finds no recognizable tooling signals
- **THEN** the agent SHALL inform the user that no tools were automatically detected
- **AND** offer the custom addition flow to manually specify checks

### Requirement: Setup Skill Existing Configuration

When `entry_points` is already populated, the `/validator-setup` skill SHALL offer options to extend or reconfigure the existing setup.

#### Scenario: Existing config shows options
- **GIVEN** `.validator/config.yml` exists with populated `entry_points`
- **WHEN** the agent invokes `/validator-setup`
- **THEN** the agent SHALL show a summary of current entry points and checks
- **AND** offer three options: add checks (scan for unconfigured tools), add custom (user-specified), or reconfigure (start fresh)

#### Scenario: Add checks filters existing
- **GIVEN** the user selects "add checks" on an existing configuration
- **WHEN** the agent scans the project
- **THEN** checks that are already configured SHALL be filtered out of the results

#### Scenario: Reconfigure backs up existing
- **GIVEN** the user selects "reconfigure" on an existing configuration
- **WHEN** the agent starts fresh setup
- **THEN** existing check files (`.validator/checks/*.yml`) and custom review files (`.validator/reviews/*.md` — reviews with user-authored prompts, not built-in `.yml` references) SHALL be renamed with a `.bak` suffix before being replaced (overwriting any previous `.bak` files)

### Requirement: Setup Skill Custom Additions

The `/validator-setup` skill SHALL support adding custom checks and reviews that the agent did not discover through scanning.

#### Scenario: Add custom check
- **GIVEN** the user wants to add a custom check
- **WHEN** the agent prompts for details
- **THEN** the agent SHALL ask for the command, target entry point, and optional settings (timeout, parallel, etc.)
- **AND** create the corresponding `.validator/checks/<name>.yml` file

#### Scenario: Add custom review
- **GIVEN** the user wants to add a custom review
- **WHEN** the agent prompts for details
- **THEN** the agent SHALL ask whether to use the built-in code-quality review or write a custom prompt
- **AND** for built-in reviews, create `.validator/reviews/<name>.yml` with `builtin: code-quality`
- **AND** for custom reviews, create `.validator/reviews/<name>.md` with the user's review prompt
- **AND** add the review name to the target entry point's `reviews` array in `config.yml`

#### Scenario: Add something else loop
- **GIVEN** the agent has created check or review files
- **WHEN** the files are written
- **THEN** the agent SHALL ask "Add something else?"
- **AND** if yes, loop back to the custom addition flow
- **AND** if no, proceed to the validation step (run `agent-validate validate`)

### Requirement: Setup Skill Check Catalog Reference

The setup skill SHALL include a `references/check-catalog.md` file that documents check categories, the check YAML schema, and example configurations. This reference is loaded by the agent when the skill is activated.

#### Scenario: Check catalog content
- **GIVEN** the setup skill is activated
- **WHEN** the agent loads the check catalog reference
- **THEN** it SHALL contain definitions for 6 check categories (build, lint, typecheck, test, security-deps, security-code)
- **AND** the check YAML schema with all available fields
- **AND** at least one example check file per category
- **AND** the review YAML schema including built-in reviewer reference
- **AND** the config entry_points schema

### Requirement: Enable-review CLI option on run and review commands
The `run` and `review` commands SHALL accept a repeatable `--enable-review <name>` option (short: `-e`) that activates disabled reviews for that invocation. The option SHALL collect multiple review names into an array and pass them to the run executor as `enableReviews`.

#### Scenario: Single review enabled via CLI
- **GIVEN** a configured review named `task-compliance` exists and its config has `enabled: false`
- **WHEN** `agent-validate run --enable-review task-compliance` is invoked
- **THEN** the `task-compliance` review SHALL be activated for that run even if its config has `enabled: false`

#### Scenario: Multiple reviews enabled via repeated flag
- **GIVEN** `task-compliance` and `security` reviews are configured in the project
- **WHEN** `agent-validate run --enable-review task-compliance --enable-review security` is invoked
- **THEN** both `task-compliance` and `security` reviews SHALL be activated for that run

#### Scenario: Enable-review on review command
- **GIVEN** a configured review named `task-compliance` exists in the project
- **WHEN** `agent-validate review --enable-review task-compliance` is invoked
- **THEN** the `task-compliance` review SHALL be activated for that review-only run

#### Scenario: Enable-review with unknown name is silently ignored
- **GIVEN** no review named `nonexistent` is configured in the project
- **WHEN** `agent-validate run --enable-review nonexistent` is invoked
- **THEN** the run SHALL proceed normally without error

### Requirement: Gauntlet-Run Skill Auto-Invocation
The validator-run skill SHALL have auto-invocation enabled so that Claude's skill invocation logic can trigger it automatically when the agent completes a coding task. The skill content is stored as static files under `skills/validator-run/` and installed to `.claude/skills/validator-run/` during init.

The validator-run skill SHALL accept `--enable-review <name>` flags from the caller, appending them to the run command for each requested review.

#### Scenario: Gauntlet-run skill auto-invocation enabled
- **GIVEN** the validator-run skill is installed at `.claude/skills/validator-run/SKILL.md`
- **WHEN** a user views the skill frontmatter
- **THEN** the skill frontmatter SHALL set `disable-model-invocation: false`
- **AND** the `description` field SHALL contain the phrase "final step after completing a coding task"
- **AND** the `description` field SHALL contain the phrase "before committing, pushing, or creating PRs"

#### Scenario: Gauntlet-run skill passes caller-requested reviews
- **GIVEN** the validator-run skill is installed and configured
- **WHEN** the caller requests a specific review to be enabled
- **THEN** the run command SHALL include `--enable-review <name>` for each requested review

#### Scenario: Gauntlet-run skill omits flag when no reviews requested
- **GIVEN** the validator-run skill is installed and configured
- **WHEN** the validator-run skill is executed without any review requests from the caller
- **THEN** the run command SHALL NOT include any `--enable-review` flags

