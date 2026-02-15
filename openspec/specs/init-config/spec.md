# init-config Specification

## Purpose
Configuration generation during `agent-gauntlet init`. Covers config file creation, review config setup, and post-init guidance.
## Requirements
### Requirement: Init generates YAML review config with built-in reference
The `init` command SHALL generate a `.gauntlet/reviews/code-quality.yml` file that references the built-in code-quality review prompt.

#### Scenario: Default init creates YAML review config
- **GIVEN** a user runs `agent-gauntlet init`
- **WHEN** the `.gauntlet/` directory is scaffolded
- **THEN** `.gauntlet/reviews/code-quality.yml` SHALL be created with content referencing `builtin: code-quality`
- **AND** the YAML file SHALL include default settings (`num_reviews: 1`)

#### Scenario: Init with --yes flag creates YAML review config
- **GIVEN** a user runs `agent-gauntlet init --yes`
- **WHEN** the `.gauntlet/` directory is scaffolded
- **THEN** `.gauntlet/reviews/code-quality.yml` SHALL be created with content referencing `builtin: code-quality`
- **AND** the YAML file SHALL include default settings (`num_reviews: 1`)

#### Scenario: Init re-run preserves existing review config
- **GIVEN** `.gauntlet/reviews/code-quality.yml` already exists
- **WHEN** the user runs `agent-gauntlet init`
- **THEN** the existing review config SHALL be preserved (not overwritten)

### Requirement: Init outputs next-step message

After completing setup, `init` SHALL print a message directing the user to run `/gauntlet-setup` to configure checks and reviews.

#### Scenario: Next-step message after init
- **GIVEN** the user runs `agent-gauntlet init`
- **WHEN** the init command completes successfully
- **THEN** the output SHALL include a message directing the user to run `/gauntlet-setup`

### Requirement: Init config skeleton with empty entry_points

The `init` command SHALL generate a `config.yml` with an empty `entry_points` array. Entry point configuration is delegated to the `/gauntlet-setup` skill.

#### Scenario: Config generated with empty entry_points
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** no `.gauntlet/config.yml` exists
- **WHEN** `.gauntlet/config.yml` is created
- **THEN** the config SHALL include `entry_points: []`
- **AND** the config SHALL include `base_branch`, `log_dir`, and `cli` sections
- **AND** the config SHALL NOT include any check or review references in entry_points

#### Scenario: Init re-run preserves existing config
- **GIVEN** `.gauntlet/config.yml` already exists
- **WHEN** the user runs `agent-gauntlet init` (with or without `--yes`)
- **THEN** the existing `config.yml` SHALL be preserved entirely (not overwritten)

#### Scenario: Config with --yes flag
- **GIVEN** the user runs `agent-gauntlet init --yes`
- **AND** no `.gauntlet/config.yml` exists
- **WHEN** `.gauntlet/config.yml` is created
- **THEN** the config SHALL include `entry_points: []`
- **AND** the `cli.default_preference` SHALL include all available CLIs

### Requirement: Init uses non-interactive config defaults

The `init` command SHALL NOT prompt for base branch, source directory, lint command, or test command. Only CLI selection remains interactive.

#### Scenario: No base branch prompt
- **GIVEN** the user runs `agent-gauntlet init`
- **WHEN** the init command runs
- **THEN** base branch SHALL be auto-detected from the git remote (falling back to `origin/main` if detection fails)
- **AND** no prompt for base branch SHALL be shown

#### Scenario: No lint or test command prompts
- **GIVEN** the user runs `agent-gauntlet init`
- **WHEN** the init command runs
- **THEN** no prompts for lint or test commands SHALL be shown
- **AND** no check YAML files SHALL be created by init
