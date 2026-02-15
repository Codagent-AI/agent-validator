# init-checksum-updates

Spec: init-hook-install

## MODIFIED Requirements

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

## ADDED Requirements

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
