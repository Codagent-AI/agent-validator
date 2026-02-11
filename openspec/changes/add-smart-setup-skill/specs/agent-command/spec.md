## ADDED Requirements
### Requirement: Setup Skill Installation

The `init` command SHALL install the `/gauntlet-setup` skill alongside existing skills (run, check, push-pr, fix-pr, status, help). The setup skill SHALL be installed as a multi-file skill with a SKILL.md and a references directory.

#### Scenario: Setup skill installed during init
- **GIVEN** a user runs `agent-gauntlet init`
- **AND** selects CLI agents that support skills
- **WHEN** skills are installed
- **THEN** the `gauntlet-setup` skill SHALL be installed with `SKILL.md` and `references/check-catalog.md`

#### Scenario: Setup skill not overwritten
- **GIVEN** the `gauntlet-setup` skill already exists
- **WHEN** `agent-gauntlet init` runs
- **THEN** existing skill files SHALL NOT be overwritten, but any missing skill files SHALL be created

### Requirement: Setup Skill Fresh Configuration

The `/gauntlet-setup` skill SHALL guide the agent through scanning a project, discovering available tooling, and configuring `entry_points` in `.gauntlet/config.yml`. On fresh setup (empty `entry_points`), the skill performs a full project scan.

#### Scenario: Config file missing
- **GIVEN** `.gauntlet/config.yml` does not exist
- **WHEN** the agent invokes `/gauntlet-setup`
- **THEN** the agent SHALL inform the user to run `agent-gauntlet init` first
- **AND** SHALL NOT proceed with scanning

#### Scenario: Fresh setup with discovered checks
- **GIVEN** `.gauntlet/config.yml` exists with `entry_points: []`
- **WHEN** the agent invokes `/gauntlet-setup`
- **THEN** the agent SHALL scan the project for tooling signals across 6 categories (build, lint, typecheck, test, security-deps, security-code)
- **AND** present a table of discovered checks with tool names, commands, and confidence levels
- **AND** ask the user to confirm which checks to enable

#### Scenario: Check YAML files created
- **GIVEN** the user confirms discovered checks
- **WHEN** the agent creates check configurations
- **THEN** individual `.gauntlet/checks/<name>.yml` files SHALL be created for each confirmed check
- **AND** each file SHALL follow the check gate schema (command, parallel, run_in_ci, run_locally, etc.)

#### Scenario: Source directory determination
- **GIVEN** the user has confirmed which checks to enable
- **WHEN** the agent needs to set the `entry_points[].path` value
- **THEN** the agent SHALL ask the user for the source directory or infer it from project structure
- **AND** the agent SHALL skip this step when adding checks to an existing entry point that already has a path

#### Scenario: Entry points updated with checks and built-in review
- **GIVEN** the user confirms checks and source directory
- **WHEN** the agent updates `.gauntlet/config.yml`
- **THEN** `entry_points` SHALL include the confirmed checks and the `code-quality` review
- **AND** the agent SHALL run `agent-gauntlet validate` to verify the configuration

#### Scenario: Suggest next steps after successful setup
- **GIVEN** the agent has validated the configuration
- **WHEN** validation passes
- **THEN** the agent SHALL inform the user they can run `/gauntlet-run`

#### Scenario: Validation fails after setup
- **GIVEN** the agent has created check files and updated config.yml
- **WHEN** `agent-gauntlet validate` reports errors
- **THEN** the agent SHALL display the validation errors to the user
- **AND** apply one corrective update attempt based on the error messages
- **AND** rerun `agent-gauntlet validate` once more
- **AND** if validation still fails, stop and ask the user for guidance

#### Scenario: User declines all discovered checks
- **GIVEN** the agent presents discovered checks to the user
- **WHEN** the user declines all of them
- **THEN** the agent SHALL offer the custom addition flow to manually specify checks or reviews
- **AND** the agent SHALL still include the `code-quality` review in `entry_points`

#### Scenario: No tools discovered during scan
- **GIVEN** `.gauntlet/config.yml` exists with `entry_points: []`
- **WHEN** the agent scans the project and finds no recognizable tooling signals
- **THEN** the agent SHALL inform the user that no tools were automatically detected
- **AND** offer the custom addition flow to manually specify checks

### Requirement: Setup Skill Existing Configuration

When `entry_points` is already populated, the `/gauntlet-setup` skill SHALL offer options to extend or reconfigure the existing setup.

#### Scenario: Existing config shows options
- **GIVEN** `.gauntlet/config.yml` exists with populated `entry_points`
- **WHEN** the agent invokes `/gauntlet-setup`
- **THEN** the agent SHALL show a summary of current entry points and checks
- **AND** offer three options: add checks (scan for unconfigured tools), add custom (user-specified), or reconfigure (start fresh)

#### Scenario: Add checks filters existing
- **GIVEN** the user selects "add checks" on an existing configuration
- **WHEN** the agent scans the project
- **THEN** checks that are already configured SHALL be filtered out of the results

#### Scenario: Reconfigure backs up existing
- **GIVEN** the user selects "reconfigure" on an existing configuration
- **WHEN** the agent starts fresh setup
- **THEN** existing check files and custom review files SHALL be renamed with a `.bak` suffix before being replaced (overwriting any previous `.bak` files)

### Requirement: Setup Skill Custom Additions

The `/gauntlet-setup` skill SHALL support adding custom checks and reviews that the agent did not discover through scanning.

#### Scenario: Add custom check
- **GIVEN** the user wants to add a custom check
- **WHEN** the agent prompts for details
- **THEN** the agent SHALL ask for the command, target entry point, and optional settings (timeout, parallel, etc.)
- **AND** create the corresponding `.gauntlet/checks/<name>.yml` file

#### Scenario: Add custom review
- **GIVEN** the user wants to add a custom review
- **WHEN** the agent prompts for details
- **THEN** the agent SHALL ask whether to use the built-in code-quality review or write a custom prompt
- **AND** for built-in reviews, create `.gauntlet/reviews/<name>.yml` with `builtin: code-quality`
- **AND** for custom reviews, create `.gauntlet/reviews/<name>.md` with the user's review prompt
- **AND** add the review name to the target entry point's `reviews` array in `config.yml`

#### Scenario: Add something else loop
- **GIVEN** the agent has created check or review files
- **WHEN** the files are written
- **THEN** the agent SHALL ask "Add something else?"
- **AND** if yes, loop back to the custom addition flow
- **AND** if no, proceed to the validation step (run `agent-gauntlet validate`)

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
