# Plugin & Update Guide

Agent Gauntlet delivers skills and hooks to AI coding agents via **plugins**. Both Claude Code and Cursor are supported, each with their own plugin format and installation mechanism.

## How It Works

The agent-gauntlet npm package includes plugin assets for both Claude Code and Cursor:

- `.claude-plugin/plugin.json` — Plugin manifest for Claude Code
- `.cursor-plugin/plugin.json` — Plugin manifest for Cursor
- `hooks/hooks.json` — Claude Code hook definitions
- `hooks/cursor-hooks.json` — Cursor hook definitions
- `.claude/skills/` — Skill files bundled in the Claude plugin
- `skills/` — Skill files bundled in the Cursor plugin

### Claude Code

When you run `agent-gauntlet init` with Claude Code selected, it:

1. Registers the marketplace: `claude plugin marketplace add pcaplan/agent-gauntlet`
2. Installs the plugin: `claude plugin install agent-gauntlet --scope <project|user>`

Claude Code then discovers and loads the plugin's skills and hooks automatically.

### Cursor

When you run `agent-gauntlet init` with Cursor selected, it copies plugin files to the appropriate directory:

- **Project scope**: `.cursor/plugins/agent-gauntlet/`
- **User scope**: `~/.cursor/plugins/agent-gauntlet/`

The copied files include `.cursor-plugin/plugin.json`, `skills/`, and `hooks/hooks.json`. Cursor auto-discovers the plugin by convention.

## Install Scope

During init, you choose an install scope:

| Scope | Flag | Where | Use When |
|-------|------|-------|----------|
| Project (local) | `--scope project` | Current project only | Want gauntlet only in this repo |
| User (global) | `--scope user` | All projects for your user | Want gauntlet everywhere |

Both scopes can coexist — if installed at both, the project-scope installation takes precedence.

## Plugin Contents

### Skills

All gauntlet skills (`/gauntlet-run`, `/gauntlet-setup`, etc.) are bundled in the plugin's `.claude/skills/` directory. See the [Skills Guide](skills-guide.md) for the full list.

## Updating

After upgrading the `agent-gauntlet` npm package, update the plugin:

```bash
agent-gauntlet update
```

This command:

1. Detects where the Claude plugin is installed (`claude plugin list --json`)
2. If Claude plugin found → updates the marketplace registry and plugin
3. Detects where the Cursor plugin is installed (file-system check)
4. If Cursor plugin found → re-copies plugin assets from the npm package
5. Refreshes Codex skills if installed (checksum-based)

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

## Cursor Plugin

The Cursor plugin is delivered via file copy during `agent-gauntlet init`. Unlike Claude Code's marketplace-based delivery, the Cursor plugin files are copied directly from the npm package to the target directory.

### Plugin Contents

- `.cursor-plugin/plugin.json` — Plugin manifest (name, version, description, license)
- `skills/` — All gauntlet skill files
- `hooks/hooks.json` — Hook definitions

### Updating

Run `agent-gauntlet update` to refresh the Cursor plugin files. This re-copies `.cursor-plugin/`, `skills/`, and `hooks/cursor-hooks.json` from the npm package to the installed location, overwriting existing files.

### Manual Installation

Copy the plugin files from the installed npm package:

```bash
# Find the package location
npm ls -g agent-gauntlet --parseable

# Copy plugin files to your project
cp -r <package-path>/.cursor-plugin .cursor/plugins/agent-gauntlet/.cursor-plugin
cp -r <package-path>/skills .cursor/plugins/agent-gauntlet/skills
mkdir -p .cursor/plugins/agent-gauntlet/hooks
cp <package-path>/hooks/cursor-hooks.json .cursor/plugins/agent-gauntlet/hooks/hooks.json
```

Or install via `/add-plugin` in Cursor or from the Cursor marketplace.

## Codex Skills (Non-Plugin)

For Codex, skills are delivered via file copy (not a plugin). During init, skill files are copied to:

- **Local scope**: `.agents/skills/` in the project
- **Global scope**: `$HOME/.agents/skills/`

Updates use SHA-256 checksum comparison to detect changed files.
