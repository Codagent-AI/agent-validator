## Context

Agent-gauntlet currently supports Cursor only as a code reviewer via the `CursorAdapter`. As of Cursor v2.5, Cursor has a full plugin system (marketplace, SKILL.md skills, hooks, commands) structurally near-identical to Claude Code's. The `CLIAdapter` interface already has skill/command directory methods — Cursor just returns `null`. Plugin install logic is entirely Claude-specific in `init-plugin.ts` and `plugin/claude-cli.ts`.

## Goals / Non-Goals

**Goals:**
- Promote Cursor to first-class coding agent via plugin-delivered skills and hooks
- Generalize the plugin install mechanism on the `CLIAdapter` interface
- Add `.cursor-plugin/` manifest and Cursor-format hooks file

**Non-Goals:**
- Cursor marketplace publishing (web-based, manual — not automatable)
- Cursor rules (`.mdc`) delivery — no Claude equivalent, not needed
- Command directory support — agent-gauntlet ships no commands
- Changes to Cursor's reviewer execution path (`execute()`)

## Decisions

### Decision 1: Plugin install methods on CLIAdapter interface

Add optional plugin lifecycle methods to the `CLIAdapter` interface:
- `detectPlugin(projectRoot: string): Promise<'user' | 'project' | null>` — check if already installed
- `installPlugin(scope: 'user' | 'project'): Promise<{ success: boolean; error?: string }>` — run adapter-specific install
- `getManualInstallInstructions(scope: 'user' | 'project'): string[]` — fallback instructions on failure

Default implementations return `null` / no-op so existing adapters (codex, gemini, github-copilot) don't need changes. Claude adapter moves its logic from `init-plugin.ts` / `plugin/claude-cli.ts` into these methods. Cursor adapter implements with filesystem operations.

### Decision 2: Cursor plugin install = local file copy

Cursor has no CLI install command. `installPlugin()` copies plugin-relevant assets (skills/, hooks/, .cursor-plugin/plugin.json) to the target directory:
- User scope: `~/.cursor/plugins/agent-gauntlet/`
- Project scope: `.cursor/plugins/agent-gauntlet/`

Only plugin-relevant assets are copied (skills/, hooks/, .cursor-plugin/plugin.json) — not dist/ since the CLI binary is already installed globally via npm.

`detectPlugin()` checks both paths for existence of `.cursor-plugin/plugin.json`.

### Decision 3: Hook files

Keep existing `hooks/hooks.json` for Claude (unchanged). Add `hooks/cursor-hooks.json` in Cursor's hook format (lowercase keys, flat entries). The Cursor plugin install copies this file into the plugin directory's `hooks/` subdirectory.

### Decision 4: Cursor adapter skill dir returns `.cursor/skills/`

For non-plugin skill installation (e.g., standalone use), `getProjectSkillDir()` returns `.cursor/skills/` and `getUserSkillDir()` returns `~/.cursor/skills/`. Mirrors Claude's pattern.

### Decision 5: Manifest structure

`.cursor-plugin/plugin.json` — same fields as Claude's (`name`, `version`, `description`, `license`). No separate `marketplace.json` — Cursor marketplace publishing is web-based. Cursor auto-discovers bundled assets by convention (skills/, hooks/ directories inside the plugin).

### Decision 6: `init-plugin.ts` generalization

Replace Claude-specific logic with adapter-dispatched logic:
1. For each dev adapter that implements `detectPlugin()`, call it
2. If found, skip scope prompt and install
3. If not found, prompt scope, call `installPlugin(scope)`
4. On failure, print `getManualInstallInstructions(scope)`
5. For Cursor, also print marketplace guidance (`/add-plugin` or cursor.com/marketplace)

## Risks / Trade-offs

**Risk 1: Cursor plugin directory paths may change.** Cursor's plugin system is relatively new (v2.5). The paths `~/.cursor/plugins/` and `.cursor/plugins/` are based on current research. If Cursor changes these, the install paths need updating. *Mitigation:* Paths are isolated in the Cursor adapter methods — easy to update.

**Risk 2: File copy install may conflict with marketplace install.** If a user installs via `agent-gauntlet init` (local copy) and also via Cursor marketplace, there could be duplicate plugins. *Mitigation:* `detectPlugin()` checks for existing installs before copying. Print marketplace note so users know both options exist.

**Risk 3: Interface bloat on CLIAdapter.** Adding 3 optional plugin methods to an interface that not all adapters use. *Mitigation:* Default implementations (return null / no-op) so non-plugin adapters don't need changes.

## Migration Plan

- No breaking changes — existing Claude flows continue to work
- `init-plugin.ts` refactored but behavior unchanged for Claude users
- New `.cursor-plugin/` directory and `hooks/cursor-hooks.json` added to package
- No database or API changes

## Open Questions

None — all deferred-to-design items resolved during design conversation.
