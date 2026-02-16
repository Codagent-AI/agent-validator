# init-hook-install Specification

## Purpose
TBD - created by archiving change add-stop-hook. Update Purpose after archive.
## Requirements
### Requirement: Settings File Creation

The hook configuration SHALL be written to the appropriate settings file for each detected CLI that supports stop hooks. For Claude Code, the target is `.claude/settings.local.json`. For Cursor, the target is `.cursor/hooks.json`.

#### Scenario: Claude Code detected during init
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** Claude Code is among the selected CLIs
- **WHEN** the init command completes
- **THEN** `.claude/settings.local.json` SHALL be created or updated with the stop hook configuration
- **AND** no user prompt SHALL be shown for hook installation

#### Scenario: Cursor detected during init
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** Cursor is among the selected CLIs
- **WHEN** the init command completes
- **THEN** `.cursor/hooks.json` SHALL be created or updated with the stop hook configuration
- **AND** no user prompt SHALL be shown for hook installation

#### Scenario: Auto-install with --yes flag
- **GIVEN** the user runs `agent-gauntlet init --yes`
- **AND** Claude Code and Cursor are both available
- **WHEN** the init command completes
- **THEN** stop hooks SHALL be installed for both CLIs without any prompts

#### Scenario: Neither Claude Code nor Cursor selected
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** neither Claude Code nor Cursor is among the selected CLIs
- **WHEN** the init command completes
- **THEN** no stop hook settings files SHALL be created

#### Scenario: .claude directory does not exist
- **GIVEN** the project has no `.claude/` directory
- **AND** Claude Code is among the selected CLIs
- **WHEN** the init command runs
- **THEN** the `.claude/` directory SHALL be created
- **AND** `.claude/settings.local.json` SHALL be created with the hook configuration

#### Scenario: settings.local.json already exists with hook
- **GIVEN** the project has `.claude/settings.local.json` with the gauntlet stop hook already configured
- **WHEN** the init command runs
- **THEN** the existing hook SHALL be preserved (no duplicate added)

#### Scenario: settings.local.json already exists without hook
- **GIVEN** the project has `.claude/settings.local.json` without the gauntlet stop hook
- **WHEN** the init command runs
- **THEN** the gauntlet stop hook SHALL be added to the existing Stop hooks array
- **AND** existing hooks SHALL be preserved

#### Scenario: .cursor directory does not exist
- **GIVEN** the project has no `.cursor/` directory
- **AND** Cursor is among the selected CLIs
- **WHEN** the init command runs
- **THEN** the `.cursor/` directory SHALL be created
- **AND** `.cursor/hooks.json` SHALL be created with the hook configuration

#### Scenario: hooks.json already exists with hook
- **GIVEN** the project has `.cursor/hooks.json` with the gauntlet stop hook already configured
- **WHEN** the init command runs
- **THEN** the existing hook SHALL be preserved (no duplicate added)

#### Scenario: hooks.json already exists without hook
- **GIVEN** the project has `.cursor/hooks.json` without the gauntlet stop hook
- **WHEN** the init command runs
- **THEN** the gauntlet stop hook SHALL be added to the existing stop hooks array
- **AND** existing hooks SHALL be preserved

### Requirement: Hook Configuration Content

The generated hook configuration SHALL include both stop hook and start hook entries, following the Claude Code hook format.

#### Scenario: Hook configuration structure
- **GIVEN** `agent-gauntlet init` runs and Claude Code is detected
- **WHEN** `.claude/settings.local.json` is created
- **THEN** it SHALL contain a `hooks.Stop` array with a command hook for `agent-gauntlet stop-hook`
- **AND** it SHALL contain a `hooks.SessionStart` array with a command hook for `agent-gauntlet start-hook`
- **AND** the stop hook timeout SHALL be 300 seconds

#### Scenario: Configuration JSON format
- **GIVEN** `agent-gauntlet init` runs and a CLI is detected
- **WHEN** the configuration is written
- **THEN** the JSON SHALL be properly formatted (indented for readability)

### Requirement: Installation Feedback

The user SHALL receive confirmation of hook installation.

#### Scenario: Successful auto-installation
- **GIVEN** Claude Code or Cursor is among the selected CLIs
- **WHEN** the stop hook is auto-installed
- **THEN** the output SHALL indicate the hook was installed for each CLI

#### Scenario: Hook already installed
- **GIVEN** the stop hook is already installed for a CLI
- **WHEN** the init command runs
- **THEN** the output SHALL indicate the hook already exists (dimmed/skipped message)

### Requirement: Cursor Hook Configuration Content

The generated Cursor hook configuration MUST follow the Cursor hooks.json format.

#### Scenario: Cursor hook configuration structure
- **GIVEN** Cursor is among the selected CLIs
- **WHEN** `.cursor/hooks.json` is created
- **THEN** it SHALL contain a `hooks.stop` array with a command entry
- **AND** the command SHALL be `agent-gauntlet stop-hook`
- **AND** the loop_limit SHALL be 10

#### Scenario: Cursor hooks.json format
- **GIVEN** Cursor is among the selected CLIs
- **WHEN** the hooks.json is created
- **THEN** the JSON SHALL include `version: 1` at the top level
- **AND** the JSON SHALL be properly formatted (indented for readability)

### Requirement: Push PR Command Installation

The init command SHALL use checksum-based comparison when installing the push-pr skill, creating missing files silently, skipping unchanged files, and prompting for changed files.

#### Scenario: Skill file created during init
- **GIVEN** a user runs `agent-gauntlet init`
- **AND** `.claude/skills/gauntlet-push-pr/SKILL.md` does not exist
- **WHEN** Phase 5 installs skills
- **THEN** the push-pr skill SHALL be created silently

#### Scenario: Skill unchanged (checksum matches)
- **GIVEN** `.claude/skills/gauntlet-push-pr/SKILL.md` already exists
- **AND** its content checksum matches the expected checksum
- **WHEN** `agent-gauntlet init` runs Phase 5
- **THEN** the file SHALL be skipped silently (no output, no modification)

#### Scenario: Skill changed (checksum differs)
- **GIVEN** `.claude/skills/gauntlet-push-pr/SKILL.md` already exists
- **AND** its content checksum does NOT match the expected checksum
- **WHEN** `agent-gauntlet init` runs Phase 5
- **THEN** the user SHALL be prompted: "Skill `gauntlet-push-pr` has changed, update it?"
- **AND** if the user confirms, the file SHALL be overwritten
- **AND** if the user declines, the file SHALL be preserved

### Requirement: Fix PR Command Installation

The init command SHALL use checksum-based comparison when installing the fix-pr skill, creating missing files silently, skipping unchanged files, and prompting for changed files.

#### Scenario: Skill file created during init
- **GIVEN** a user runs `agent-gauntlet init`
- **AND** `.claude/skills/gauntlet-fix-pr/SKILL.md` does not exist
- **WHEN** Phase 5 installs skills
- **THEN** the fix-pr skill SHALL be created silently

#### Scenario: Skill unchanged (checksum matches)
- **GIVEN** `.claude/skills/gauntlet-fix-pr/SKILL.md` already exists
- **AND** its content checksum matches the expected checksum
- **WHEN** `agent-gauntlet init` runs Phase 5
- **THEN** the file SHALL be skipped silently

#### Scenario: Skill changed (checksum differs)
- **GIVEN** `.claude/skills/gauntlet-fix-pr/SKILL.md` already exists
- **AND** its content checksum does NOT match the expected checksum
- **WHEN** `agent-gauntlet init` runs Phase 5
- **THEN** the user SHALL be prompted: "Skill `gauntlet-fix-pr` has changed, update it?"
- **AND** if the user confirms, the file SHALL be overwritten
- **AND** if the user declines, the file SHALL be preserved

### Requirement: Init installs gauntlet-help for Claude

The init command SHALL use checksum-based comparison when installing the gauntlet-help skill bundle, creating missing directories silently, skipping unchanged bundles, and prompting for changed bundles.

#### Scenario: Claude installation includes gauntlet-help bundle
- **GIVEN** a user runs `agent-gauntlet init`
- **AND** Claude is selected for skill installation
- **AND** `.claude/skills/gauntlet-help/` does not exist
- **WHEN** skills are installed
- **THEN** `.claude/skills/gauntlet-help/SKILL.md` SHALL be installed
- **AND** the `gauntlet-help` reference files SHALL be installed

#### Scenario: Skill bundle unchanged (checksum matches)
- **GIVEN** `.claude/skills/gauntlet-help/` already exists
- **AND** the combined checksum of all files in the directory matches the expected checksum
- **WHEN** `agent-gauntlet init` runs Phase 5
- **THEN** the skill directory SHALL be skipped silently

#### Scenario: Skill bundle changed (checksum differs)
- **GIVEN** `.claude/skills/gauntlet-help/` already exists
- **AND** the combined checksum of all files in the directory does NOT match the expected checksum
- **WHEN** `agent-gauntlet init` runs Phase 5
- **THEN** the user SHALL be prompted: "Skill `gauntlet-help` has changed, update it?"
- **AND** one prompt per changed skill (not per file)

### Requirement: Checksum computation for skills

Skill checksums SHALL be computed over the combined content of all files in the skill directory (SKILL.md + references/*), providing a single checksum per skill.

#### Scenario: Single-file skill checksum
- **GIVEN** a skill directory contains only `SKILL.md`
- **WHEN** the checksum is computed
- **THEN** it SHALL be the hash of `SKILL.md` content

#### Scenario: Multi-file skill checksum
- **GIVEN** a skill directory contains `SKILL.md` and `references/config.md`
- **WHEN** the checksum is computed
- **THEN** it SHALL be the hash of the concatenated content of all files (sorted by path for determinism)

### Requirement: Checksum computation for hooks

Hook checksums SHALL be computed over gauntlet-specific hook entries only, not the entire settings file.

#### Scenario: Hook checksum includes only gauntlet entries
- **GIVEN** `.claude/settings.local.json` contains both gauntlet hooks and user-defined hooks
- **WHEN** the hook checksum is computed
- **THEN** it SHALL only include entries where the command starts with `agent-gauntlet`
- **AND** user-defined hooks SHALL NOT affect the checksum

#### Scenario: Hook file missing
- **GIVEN** `.claude/settings.local.json` does not exist
- **WHEN** Phase 5 runs
- **THEN** the hook file SHALL be created silently with gauntlet hook entries

#### Scenario: Hook entries unchanged (checksum matches)
- **GIVEN** `.claude/settings.local.json` exists
- **AND** the gauntlet hook entries checksum matches the expected checksum
- **WHEN** Phase 5 runs
- **THEN** the hook entries SHALL be skipped silently

#### Scenario: Hook entries changed (checksum differs)
- **GIVEN** `.claude/settings.local.json` exists
- **AND** the gauntlet hook entries checksum does NOT match the expected checksum
- **WHEN** Phase 5 runs
- **THEN** the user SHALL be prompted about updating the hook configuration
- **AND** one prompt per changed hook file (not per entry)

#### Scenario: --yes overwrites changed hook entries without asking
- **GIVEN** the user runs `agent-gauntlet init --yes`
- **AND** `.claude/settings.local.json` exists
- **AND** the gauntlet hook entries checksum does NOT match the expected checksum
- **WHEN** Phase 5 runs
- **THEN** the hook entries SHALL be overwritten without prompting

### Requirement: Hook installation uses development CLI selection

Hook installation in Phase 5 SHALL only install hooks for CLIs selected as development CLIs in Phase 2, not all detected CLIs.

#### Scenario: Only development CLIs get hooks
- **GIVEN** CLIs `claude`, `codex`, and `gemini` are detected
- **AND** the user selects only `claude` as a development CLI
- **WHEN** Phase 5 installs hooks
- **THEN** hooks SHALL be installed only for `claude`
- **AND** no hooks SHALL be installed for `codex` or `gemini`

#### Scenario: Development CLI without hook support
- **GIVEN** the user selects `codex` as a development CLI
- **WHEN** Phase 5 runs
- **THEN** no hooks SHALL be installed for `codex` (it has no hook support)
- **AND** a warning SHALL have been displayed in Phase 2

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

### Requirement: Start Hook Installation

The init command SHALL install a start hook for each detected CLI alongside the stop hook, priming the agent with gauntlet instructions at session start.

#### Scenario: Claude Code start hook installed during init
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** Claude Code is detected as an available CLI
- **WHEN** the init command installs hooks
- **THEN** `.claude/settings.local.json` SHALL contain a `hooks.SessionStart` array with a command hook
- **AND** the command SHALL be `agent-gauntlet start-hook`
- **AND** the hook SHALL be non-async (synchronous)
- **AND** the hook matcher SHALL cover session start events (startup, resume, clear, compact)

#### Scenario: Cursor start hook installed during init
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** Cursor is detected as an available CLI
- **WHEN** the init command installs hooks
- **THEN** `.cursor/hooks.json` SHALL contain a `hooks.sessionStart` array with a command entry
- **AND** the command SHALL be `agent-gauntlet start-hook --adapter cursor`

#### Scenario: Start hook merged with existing Claude Code settings
- **GIVEN** `.claude/settings.local.json` already exists with other hooks
- **WHEN** the start hook is installed
- **THEN** the existing hooks configuration SHALL be merged (not overwritten)
- **AND** existing SessionStart hooks SHALL be preserved alongside the new hook

#### Scenario: Cursor start hook merged with existing hooks
- **GIVEN** `.cursor/hooks.json` already exists with other hooks
- **WHEN** the start hook is installed
- **THEN** the existing hooks configuration SHALL be merged (not overwritten)
- **AND** existing sessionStart hooks SHALL be preserved alongside the new hook

#### Scenario: Duplicate start hook prevention
- **GIVEN** `.claude/settings.local.json` already contains an `agent-gauntlet start-hook` entry in `hooks.SessionStart`
- **WHEN** `agent-gauntlet init` runs again
- **THEN** no duplicate start hook entry SHALL be added

#### Scenario: Cursor duplicate start hook prevention
- **GIVEN** `.cursor/hooks.json` already contains an `agent-gauntlet start-hook --adapter cursor` entry in `hooks.sessionStart`
- **WHEN** `agent-gauntlet init` runs again
- **THEN** no duplicate start hook entry SHALL be added

### Requirement: Start Hook Installation Feedback

The user SHALL receive confirmation of start hook installation via a console log message.

#### Scenario: Successful start hook installation
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** a CLI is detected
- **WHEN** the start hook is installed
- **THEN** it SHALL log a message to stdout indicating the start hook was installed (mirroring the existing stop hook confirmation message pattern)

