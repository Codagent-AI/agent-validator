# Task: Generalize init-plugin for multi-adapter support

## Goal

Refactor `init-plugin.ts` to dispatch plugin installation through the adapter interface instead of hardcoding Claude CLI commands, enabling any adapter with plugin support to participate in the init flow.

## Background

Currently `init-plugin.ts` contains Claude-specific functions: `detectInstalledPlugin()` calls `claude plugin list --json`, `installClaudePluginWithFallback()` runs marketplace add + install, and `detectClaudePluginScope()` parses Claude's plugin list output. After the Claude adapter implements the plugin lifecycle methods, these functions should be replaced with generic adapter-dispatched logic.

The generic flow: for each dev adapter, check if it implements `detectPlugin()`. If the plugin is detected, skip install. If not, prompt for scope, call `installPlugin(scope)`. On failure, print `getManualInstallInstructions(scope)`. The `getCodexSkillsBaseDir()` function and any other non-plugin logic in this file should remain.

The hook installation for Cursor currently writes directly to `.cursor/hooks.json` during init. With plugin-based delivery, init SHALL NOT write hook entries directly — they come from the plugin's hooks file.

Read these files before starting:
- `openspec/changes/cursor-coding-agent-support/design.md`
- `src/commands/init-plugin.ts`
- `src/commands/init.ts`
- `src/commands/init-hooks.ts`

## Spec

### Requirement: Plugin installation with scope

The `init` command SHALL support plugin installation for any adapter that provides a plugin install mechanism. The init flow SHALL prompt for scope, delegate to the adapter's install mechanism, and handle success/failure uniformly.

#### Scenario: Adapter-specific installation dispatched
- **WHEN** the user selects a development CLI that supports plugin installation
- **THEN** init SHALL delegate to that adapter's installation strategy with the selected scope

#### Scenario: Already-installed detection
- **WHEN** the plugin is already installed for the selected adapter at any scope
- **THEN** init SHALL inform the user it is already installed and at which scope
- **AND** SHALL skip the scope prompt
- **AND** SHALL skip the install step

#### Scenario: Installation failure
- **WHEN** the adapter's installation strategy fails
- **THEN** init SHALL warn the user that plugin installation failed
- **AND** SHALL print adapter-specific manual installation instructions
- **AND** SHALL continue with remaining init steps

### Requirement: Cursor hooks delivered through plugin

#### Scenario: Cursor hooks delivered through plugin
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** Cursor is among the selected development CLIs
- **WHEN** the plugin is installed
- **THEN** hooks SHALL be served from the plugin's `hooks/hooks.json`
- **AND** init SHALL NOT write hook entries directly to `.cursor/hooks.json`

## Done When

`init-plugin.ts` no longer contains Claude-specific install logic (moved to adapter), dispatches through the adapter interface for all plugin-capable adapters, and tests covering the above scenarios pass.
