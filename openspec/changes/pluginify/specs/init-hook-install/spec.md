## MODIFIED Requirements

### Requirement: Hook delivery via plugin

Claude Code hooks SHALL be delivered as part of the agent-gauntlet plugin via `hooks/hooks.json` in the plugin directory, instead of being written to `.claude/settings.local.json` during init.

#### Scenario: Claude hooks delivered through plugin
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** Claude is among the selected development CLIs
- **WHEN** the plugin is installed
- **THEN** hooks SHALL be served from the plugin's `hooks/hooks.json`
- **AND** init SHALL NOT write hook entries to `.claude/settings.local.json`

#### Scenario: Plugin hooks.json contains start and stop hooks
- **WHEN** the agent-gauntlet plugin is installed
- **THEN** the plugin's `hooks/hooks.json` SHALL contain a stop hook for `agent-gauntlet stop-hook`
- **AND** SHALL contain a start hook for `agent-gauntlet start-hook`
- **AND** the stop hook timeout SHALL be 300 seconds

## REMOVED Requirements

### Requirement: Settings File Creation
**Reason**: Hooks are now delivered via the plugin's `hooks/hooks.json` instead of written to project settings files during init.
**Migration**: Re-run `agent-gauntlet init` to install the plugin. Existing `settings.local.json` hook entries can be manually removed.

### Requirement: Hook Configuration Content
**Reason**: Hook configuration is now static in the plugin's `hooks/hooks.json`, not generated during init.
**Migration**: No action needed -- plugin installation handles hook delivery.

### Requirement: Installation Feedback
**Reason**: Hook installation is now part of plugin installation, not a separate step.
**Migration**: Plugin installation success message covers hooks.

### Requirement: Cursor Hook Configuration Content
**Reason**: Cursor hook support is deferred.
**Migration**: None -- Cursor hooks will not be installed.

### Requirement: Hook installation uses development CLI selection
**Reason**: Hooks are now part of the plugin, not separately installed per CLI.
**Migration**: No action needed.

### Requirement: Checksum computation for hooks
**Reason**: Hooks are static in the plugin, not written/checksummed during init.
**Migration**: No action needed.

### Requirement: Start Hook Installation
**Reason**: Start hooks are now delivered via the plugin's `hooks/hooks.json`.
**Migration**: Re-run `agent-gauntlet init` to install the plugin.

### Requirement: Start Hook Installation Feedback
**Reason**: Covered by plugin installation feedback.
**Migration**: No action needed.

### Requirement: Init installs gauntlet-help for Claude
**Reason**: Skills are now delivered via the plugin, not copied during init.
**Migration**: Re-run `agent-gauntlet init` to install the plugin.
