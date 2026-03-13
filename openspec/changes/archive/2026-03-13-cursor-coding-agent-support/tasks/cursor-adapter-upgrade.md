# Task: Upgrade Cursor adapter with skill dirs and plugin methods

## Goal

Update the `CursorAdapter` to return non-null skill directory paths and implement the plugin lifecycle methods using local file copy, promoting Cursor from reviewer-only to full coding agent.

## Background

The `CursorAdapter` in `src/cli-adapters/cursor.ts` currently returns `null` from `getProjectSkillDir()` and `getUserSkillDir()`. Per the design, these should return `.cursor/skills/` and `~/.cursor/skills/` respectively, mirroring Claude's pattern.

Cursor has no CLI install command for plugins. The plugin install strategy copies plugin-relevant assets (skills/, hooks/cursor-hooks.json, .cursor-plugin/plugin.json) to either `~/.cursor/plugins/agent-gauntlet/` (user scope) or `.cursor/plugins/agent-gauntlet/` (project scope). Detection checks both paths for existence of `.cursor-plugin/plugin.json`.

Manual install instructions should include the file copy paths and mention that the plugin is also available via `/add-plugin` in Cursor or at the Cursor marketplace.

Read these files before starting:
- `openspec/changes/cursor-coding-agent-support/design.md`
- `src/cli-adapters/cursor.ts`
- `src/cli-adapters/claude.ts`

## Spec

### Requirement: Skill directory support

The `CursorAdapter` SHALL expose project-level and user-level skill directories so that skills can be installed for Cursor.

#### Scenario: Project skill dir returned
- **WHEN** `getProjectSkillDir()` is called
- **THEN** it SHALL return a non-null path where project-scoped skills are stored for Cursor

#### Scenario: User skill dir returned
- **WHEN** `getUserSkillDir()` is called
- **THEN** it SHALL return a non-null path where user-scoped skills are stored for Cursor

### Requirement: Plugin installation with scope

The `init` command SHALL install the agent-gauntlet Cursor plugin by copying plugin files to the appropriate directory based on scope.

#### Scenario: User selects user scope
- **WHEN** the user selects global installation
- **THEN** init SHALL copy plugin files to `~/.cursor/plugins/agent-gauntlet/`

#### Scenario: User selects project scope
- **WHEN** the user selects local/project installation
- **THEN** init SHALL copy plugin files to `.cursor/plugins/agent-gauntlet/`

### Requirement: Already-installed detection

Init SHALL check both `~/.cursor/plugins/agent-gauntlet/` and `.cursor/plugins/agent-gauntlet/` before attempting installation.

#### Scenario: Plugin already installed
- **WHEN** the plugin is found at either scope
- **THEN** init SHALL inform the user it is already installed and at which scope
- **AND** SHALL skip the scope prompt
- **AND** SHALL skip the install step

### Requirement: Installation failure handling

#### Scenario: Plugin install fails
- **WHEN** copying plugin files fails
- **THEN** init SHALL warn the user that plugin installation failed
- **AND** SHALL print manual installation instructions
- **AND** SHALL continue with remaining init steps

### Requirement: Marketplace instructions

#### Scenario: Marketplace guidance printed
- **WHEN** Cursor plugin installation completes (success or failure)
- **THEN** init SHALL print a note that the plugin is also available via `/add-plugin` in Cursor or at the Cursor marketplace

## Done When

`CursorAdapter` returns non-null skill directories, implements `detectPlugin()` with filesystem checks, implements `installPlugin()` with file copy, and tests covering the above scenarios pass.
