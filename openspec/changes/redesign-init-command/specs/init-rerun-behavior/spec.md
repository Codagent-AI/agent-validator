# init-rerun-behavior

Spec: init-hook-install

## ADDED Requirements

### Requirement: Re-run skips interactive phases

When `.gauntlet/` already exists, the init command SHALL skip Phases 2–4 and proceed directly from Phase 1 (detection) to Phase 5 (external file installation).

#### Scenario: Re-run skips CLI selection and scaffolding
- **GIVEN** a user runs `agent-gauntlet init`
- **AND** the `.gauntlet/` directory already exists
- **WHEN** Phase 1 completes CLI detection
- **THEN** Phases 2 (dev CLI selection), 3 (review CLI selection), and 4 (scaffold) SHALL be skipped
- **AND** the command SHALL proceed directly to Phase 5

#### Scenario: Re-run uses all detected CLIs for external files
- **GIVEN** `.gauntlet/` already exists
- **AND** the user originally selected a subset of detected CLIs
- **WHEN** `agent-gauntlet init` re-runs Phase 5
- **THEN** external files (skills and hooks) SHALL be installed for all currently detected CLIs
- **AND** the config inside `.gauntlet/` SHALL NOT be modified

#### Scenario: Re-run with newly detected CLI
- **GIVEN** `.gauntlet/` already exists
- **AND** a new CLI has been installed since the last init
- **WHEN** `agent-gauntlet init` runs
- **THEN** Phase 1 SHALL detect the new CLI
- **AND** Phase 5 SHALL install hooks for the new CLI (if it supports hooks)

#### Scenario: Re-run with --yes flag
- **GIVEN** `.gauntlet/` already exists
- **WHEN** `agent-gauntlet init --yes` runs
- **THEN** Phases 2–4 SHALL be skipped (same as interactive re-run)
- **AND** changed files SHALL be overwritten without prompting
