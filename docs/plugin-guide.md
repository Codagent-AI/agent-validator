# Plugin & Update Guide

Agent Gauntlet delivers skills and hooks to Claude Code via a **Claude Code plugin**. This replaces the previous approach of copying skill files and writing hook entries to `.claude/settings.local.json`.

## How It Works

The agent-gauntlet npm package includes:

- `.claude-plugin/plugin.json` — Plugin manifest for discovery by Claude Code
- `hooks/hooks.json` — Static hook definitions (stop hook + session start hook)
- `.claude/skills/` — Skill files bundled in the plugin

When you run `agent-gauntlet init` with Claude Code selected, it:

1. Registers the marketplace: `claude plugin marketplace add pcaplan/agent-gauntlet`
2. Installs the plugin: `claude plugin install agent-gauntlet --scope <project|user>`

Claude Code then discovers and loads the plugin's skills and hooks automatically.

## Install Scope

During init, you choose an install scope:

| Scope | Flag | Where | Use When |
|-------|------|-------|----------|
| Project (local) | `--scope project` | Current project only | Want gauntlet only in this repo |
| User (global) | `--scope user` | All projects for your user | Want gauntlet everywhere |

Both scopes can coexist — if installed at both, the project-scope installation takes precedence.

## Plugin Contents

### Hooks (`hooks/hooks.json`)

The plugin delivers two hooks:

- **Stop hook**: Runs `agent-gauntlet stop-hook` when the agent tries to stop (300s timeout)
- **Session start hook**: Runs `agent-gauntlet start-hook` to prime agent sessions with verification instructions

These are served directly from the plugin — no manual hook configuration in settings.json is needed.

### Skills

All gauntlet skills (`/gauntlet-run`, `/gauntlet-setup`, etc.) are bundled in the plugin's `.claude/skills/` directory. See the [Skills Guide](skills-guide.md) for the full list.

## Updating

After upgrading the `agent-gauntlet` npm package, update the plugin:

```bash
agent-gauntlet update
```

This command:

1. Detects where the plugin is installed (`claude plugin list --json`)
2. Updates the marketplace registry: `claude plugin marketplace update agent-gauntlet`
3. Updates the plugin: `claude plugin update agent-gauntlet@pcaplan/agent-gauntlet`
4. Refreshes Codex skills if installed (checksum-based)

### Scope Detection

The update command auto-detects the installed scope:

- If installed at project scope → updates project installation
- If installed at user scope only → updates user installation
- If installed at both → updates project scope (closest wins)
- If not installed → error with instructions to run `agent-gauntlet init`

### Re-running Init

Running `agent-gauntlet init` on a project that already has `.gauntlet/` delegates to the update flow. If the plugin isn't installed yet, it falls back to a fresh install.

## Manual Installation

If you prefer not to use `agent-gauntlet init`:

```bash
# Install the npm package
npm install -g agent-gauntlet

# Register marketplace and install plugin
claude plugin marketplace add pcaplan/agent-gauntlet
claude plugin install agent-gauntlet --scope project
```

## Troubleshooting

### Plugin not found after install

Verify the plugin is installed:

```bash
claude plugin list --json
```

Look for an entry with `name: "agent-gauntlet"`.

### Hooks not firing

Ensure the plugin is installed at the correct scope for your project. Project-scope plugins only apply to the project where they were installed.

### Update fails

If `agent-gauntlet update` fails, try manual update:

```bash
claude plugin marketplace update agent-gauntlet
claude plugin update agent-gauntlet@pcaplan/agent-gauntlet
```

## Codex Skills (Non-Plugin)

For Codex, skills are delivered via file copy (not a plugin). During init, skill files are copied to:

- **Local scope**: `.agents/skills/` in the project
- **Global scope**: `$HOME/.agents/skills/`

Updates use SHA-256 checksum comparison to detect changed files.
