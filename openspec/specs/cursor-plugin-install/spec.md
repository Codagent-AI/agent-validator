# cursor-plugin-install Specification

## Purpose
TBD - created by archiving change cursor-coding-agent-support. Update Purpose after archive.
## Requirements
### Requirement: Plugin installation with scope

The `init` command SHALL install the agent-gauntlet Cursor plugin by copying plugin files to the appropriate directory based on scope: `~/.cursor/plugins/agent-gauntlet/` (user) or `.cursor/plugins/agent-gauntlet/` (project).

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

When plugin file copying fails, init SHALL warn the user, print manual installation instructions, and continue with remaining init steps.

#### Scenario: Plugin install fails
- **WHEN** copying plugin files fails
- **THEN** init SHALL warn the user that plugin installation failed
- **AND** SHALL print manual installation instructions
- **AND** SHALL continue with remaining init steps

### Requirement: Marketplace instructions

Since Cursor marketplace registration is web-based (no CLI command), init SHALL print instructions directing the user to install from the marketplace as an alternative to the local install.

#### Scenario: Marketplace guidance printed
- **WHEN** Cursor plugin installation completes (success or failure)
- **THEN** init SHALL print a note that the plugin is also available via `/add-plugin` in Cursor or at the Cursor marketplace

