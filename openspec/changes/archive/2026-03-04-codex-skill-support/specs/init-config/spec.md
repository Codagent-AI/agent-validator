## ADDED Requirements

### Requirement: Init installs skills to Codex skill directory

When codex is selected as a development CLI, `init` SHALL install gauntlet skills to `.agents/skills/` in addition to `.claude/skills/`. The same source skills, checksum logic, and overwrite prompts SHALL apply to both directories.

#### Scenario: Codex selected as dev CLI installs skills to .agents/skills/
- **WHEN** the user selects `codex` as a development CLI
- **AND** init reaches the skill installation phase
- **THEN** all gauntlet skills SHALL be copied to `.agents/skills/<skill-name>/`
- **AND** each skill directory SHALL contain the same files as the `.claude/skills/` copy

#### Scenario: Codex not selected skips .agents/skills/ installation
- **WHEN** the user does not select `codex` as a development CLI
- **THEN** no `.agents/skills/` directory SHALL be created

#### Scenario: Codex skill checksum matches skips update
- **WHEN** a skill already exists in `.agents/skills/<skill-name>/`
- **AND** its checksum matches the source skill
- **THEN** the skill SHALL be skipped without prompting

#### Scenario: Codex skill checksum differs prompts for overwrite
- **WHEN** a skill already exists in `.agents/skills/<skill-name>/`
- **AND** its checksum differs from the source skill
- **THEN** the user SHALL be prompted to overwrite (unless `--yes` is passed)

#### Scenario: --yes flag overwrites changed Codex skills without asking
- **WHEN** the user runs `agent-gauntlet init --yes`
- **AND** a Codex skill exists with a different checksum
- **THEN** the skill SHALL be overwritten without prompting

### Requirement: CodexAdapter reports project skill directory

`CodexAdapter.getProjectSkillDir()` SHALL return `.agents/skills` so the adapter system correctly reflects Codex's native skill location.

#### Scenario: CodexAdapter returns .agents/skills for project skill dir
- **WHEN** `getProjectSkillDir()` is called on a `CodexAdapter` instance
- **THEN** it SHALL return `.agents/skills`

### Requirement: Skill overwrite prompt supports update-all option

The skill overwrite prompt SHALL offer an "update all" option that accepts all remaining skill updates without further prompting. This applies across all skill directories in a single init run.

#### Scenario: User selects update-all on first changed skill
- **WHEN** multiple skills have changed checksums
- **AND** the user selects "update all" on the first overwrite prompt
- **THEN** all remaining changed skills SHALL be overwritten without further prompts

#### Scenario: User answers individually then selects update-all
- **WHEN** the user answers "yes" or "no" to individual skill prompts
- **AND** then selects "update all" on a subsequent prompt
- **THEN** all remaining changed skills after that point SHALL be overwritten without further prompts

#### Scenario: Update-all carries across skill directories
- **WHEN** the user selects "update all" during `.claude/skills/` installation
- **AND** codex is selected with `.agents/skills/` installation pending
- **THEN** the update-all state SHALL carry forward to the `.agents/skills/` directory
- **AND** no further overwrite prompts SHALL be shown

## MODIFIED Requirements

### Requirement: Init outputs next-step message

After completing setup, `init` SHALL print context-aware instructions based on the selected development CLIs. Native CLI users (Claude Code, Cursor) SHALL receive `/gauntlet-setup` slash-command instructions. Non-native CLI users SHALL receive `@file_path` reference instructions. Codex users SHALL receive Codex-native `.agents/skills/` path references.

#### Scenario: Claude Code user instructions
- **GIVEN** the user selected `claude` as a development CLI
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include: "To complete setup, run `/gauntlet-setup` in your CLI. This will guide you through configuring the static checks (unit tests, linters, etc) that Agent Gauntlet will run."

#### Scenario: Cursor user instructions
- **GIVEN** the user selected `cursor` as a development CLI
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include: "To complete setup, run `/gauntlet-setup` in your CLI. This will guide you through configuring the static checks (unit tests, linters, etc) that Agent Gauntlet will run."

#### Scenario: Codex user instructions
- **GIVEN** the user selected `codex` as a development CLI
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL reference skills using `.agents/skills/` paths
- **AND** the output SHALL list all available skills with `.agents/skills/<skill-name>/SKILL.md` syntax

#### Scenario: Non-native non-codex CLI user instructions
- **GIVEN** the user selected a non-native, non-codex CLI (e.g., `gemini`) as a development CLI
- **AND** the user did NOT select `claude`, `cursor`, or `codex`
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include `@.claude/skills/` path references (existing behavior)

#### Scenario: Mixed CLI selection instructions
- **GIVEN** the user selected both `claude` and `codex` as development CLIs
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include BOTH the `/gauntlet-setup` instructions AND the Codex `.agents/skills/` instructions
- **AND** the instructions SHALL be grouped by CLI type

#### Scenario: --yes flag still shows instructions
- **GIVEN** the user runs `agent-gauntlet init --yes`
- **WHEN** the init command completes (Phase 6)
- **THEN** the post-init instructions SHALL still be displayed (instructions are never skipped)
