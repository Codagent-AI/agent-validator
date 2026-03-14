# cursor-plugin-install Specification

## Purpose
Cursor plugin installation during `agent-gauntlet init`. Covers file-copy-based plugin installation with user/project scope, already-installed detection, failure handling, and marketplace guidance.
## Requirements
### Requirement: Plugin installation with scope

The `init` command SHALL install the agent-gauntlet Cursor plugin by copying plugin files to the appropriate directory based on scope: `~/.cursor/plugins/agent-gauntlet/` (user) or `.cursor/plugins/agent-gauntlet/` (project).

#### Scenario: User selects user scope
- **GIVEN** the user runs `agent-gauntlet init` with Cursor selected
- **WHEN** the user selects global installation
- **THEN** init SHALL copy plugin files to `~/.cursor/plugins/agent-gauntlet/`

#### Scenario: User selects project scope
- **GIVEN** the user runs `agent-gauntlet init` with Cursor selected
- **WHEN** the user selects local/project installation
- **THEN** init SHALL copy plugin files to `.cursor/plugins/agent-gauntlet/`

### Requirement: Already-installed detection

Init SHALL check both `~/.cursor/plugins/agent-gauntlet/` and `.cursor/plugins/agent-gauntlet/` before attempting installation.

#### Scenario: Plugin already installed
- **GIVEN** the user runs `agent-gauntlet init` with Cursor selected
- **WHEN** the plugin is found at either scope
- **THEN** init SHALL inform the user it is already installed and at which scope
- **AND** SHALL skip the scope prompt
- **AND** SHALL skip the install step

### Requirement: Installation failure handling

When plugin file copying fails, init SHALL warn the user, print manual installation instructions, and continue with remaining init steps.

#### Scenario: Plugin install fails
- **GIVEN** the user runs `agent-gauntlet init` with Cursor selected
- **WHEN** copying plugin files fails
- **THEN** init SHALL warn the user that plugin installation failed
- **AND** SHALL print manual installation instructions
- **AND** SHALL continue with remaining init steps

### Requirement: Marketplace instructions

Since Cursor marketplace registration is web-based (no CLI command), the manual installation instructions SHALL mention the Cursor marketplace as an alternative installation path.

#### Scenario: Marketplace guidance on failure
- **GIVEN** the user runs `agent-gauntlet init` with Cursor selected
- **WHEN** Cursor plugin installation fails
- **THEN** the manual installation instructions SHALL mention `/add-plugin` in Cursor or the Cursor marketplace as an alternative

