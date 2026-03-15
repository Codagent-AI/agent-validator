# Task: Add plugin lifecycle methods to Claude adapter

## Goal

Add optional plugin lifecycle methods to the `CLIAdapter` interface and implement them on the Claude adapter, moving existing plugin install logic from `init-plugin.ts` into the adapter.

## Background

The `CLIAdapter` interface in `src/cli-adapters/shared.ts` currently has no plugin-related methods. Claude plugin installation logic lives in `src/commands/init-plugin.ts` (using `detectInstalledPlugin`, `installClaudePluginWithFallback`, `detectClaudePluginScope`) and `src/plugin/claude-cli.ts` (the underlying CLI wrappers).

Per the design, three optional methods are added to `CLIAdapter`:
- `detectPlugin(projectRoot: string): Promise<'user' | 'project' | null>`
- `installPlugin(scope: 'user' | 'project'): Promise<{ success: boolean; error?: string }>`
- `getManualInstallInstructions(scope: 'user' | 'project'): string[]`

These are optional (`?:`) so existing adapters (codex, gemini, github-copilot) don't need changes. The Claude adapter implements them by wrapping the existing `plugin/claude-cli.ts` helpers. The functions in `init-plugin.ts` that are Claude-specific (`detectInstalledPlugin`, `installClaudePluginWithFallback`, `detectClaudePluginScope`) move into the Claude adapter or become internal.

Read these files before starting:
- `openspec/changes/cursor-coding-agent-support/design.md`
- `src/cli-adapters/shared.ts`
- `src/cli-adapters/claude.ts`
- `src/commands/init-plugin.ts`
- `src/plugin/claude-cli.ts`

## Spec

### Requirement: Plugin installation with scope

The `init` command SHALL support plugin installation for any adapter that provides a plugin install mechanism. Each adapter SHALL define its own installation strategy.

#### Scenario: Adapter-specific installation dispatched
- **WHEN** the user selects a development CLI that supports plugin installation
- **THEN** init SHALL delegate to that adapter's installation strategy with the selected scope

### Requirement: Already-installed detection

#### Scenario: Already-installed detection
- **WHEN** the plugin is already installed for the selected adapter at any scope
- **THEN** init SHALL inform the user it is already installed and at which scope
- **AND** SHALL skip the scope prompt
- **AND** SHALL skip the install step

### Requirement: Installation failure

#### Scenario: Installation failure
- **WHEN** the adapter's installation strategy fails
- **THEN** init SHALL warn the user that plugin installation failed
- **AND** SHALL print adapter-specific manual installation instructions
- **AND** SHALL continue with remaining init steps

## Done When

The `CLIAdapter` interface has the three optional plugin methods, the Claude adapter implements them wrapping existing logic, and tests covering the above scenarios pass.
