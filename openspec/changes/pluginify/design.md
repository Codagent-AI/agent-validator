## Context

Agent-gauntlet is an npm CLI package that currently copies 9 skill directories into `.claude/skills/` and `.agents/skills/` (Codex) during `init`, and writes hook entries into `.claude/settings.local.json` and `.cursor/hooks.json`. This change replaces the skill-copy + hook-write approach for Claude with plugin-based delivery, adds a new `update` command, and keeps file-copy for Codex and other CLIs.

## Goals / Non-Goals

**Goals:**
- Deliver skills and hooks via Claude plugin instead of file copy
- Support local (project) and global (user) plugin scopes
- Add `update` command for in-place plugin refresh
- Support global Codex skill installation (`$HOME/.agents/skills/`)
- Re-run `init` delegates to update logic

**Non-Goals:**
- Marketplace registration (plugin is installed from GitHub, not a curated marketplace)
- Cursor hook support (deferred)
- Moving Codex to a plugin system (doesn't have one)
- Migration tooling for cleaning up old `.claude/skills/` files
- Renaming skills to use colon syntax (plugin auto-namespaces; fuzzy matching handles invocation)

## Decisions

### D1: Plugin CLI wrapper module

Create `src/plugin/claude-cli.ts` with typed functions wrapping `claude plugin *` shell commands: `addMarketplace()`, `installPlugin(scope)`, `listPlugins()`, `updateMarketplace()`, `updatePlugin()`. Both `init` and `update` import from this module.

### D2: Shared update logic module

Create `src/commands/plugin-update.ts` containing the core update logic (detect plugin location, run marketplace update, run plugin update, refresh Codex skills). Both the `update` command and init re-run import this module.

### D3: Static hooks/hooks.json

Hand-maintain `hooks/hooks.json` at package root as the source of truth for start/stop hook definitions. Remove hook generation logic from `init-hooks.ts`. The file references `agent-gauntlet stop-hook` and `agent-gauntlet start-hook` directly (assumes binary is on PATH via global npm install).

### D4: Plugin manifest

Add `.claude-plugin/plugin.json` at package root with name, version, description, license. Version kept in sync with `package.json` automatically via the release script (same `jq` approach as flokay).

### D5: Codex skill marker detection

The `update` command detects gauntlet Codex skills by checking for the `gauntlet-run` directory in `.agents/skills/` (local) or `$HOME/.agents/skills/` (global).

### D6: Package files update

Add `.claude-plugin/` and `hooks/` to `package.json` `files` array so they ship with the npm package. Skills remain in `skills/` (served by the plugin, still needed for Codex file copy).

### D7: init-hooks.ts simplification

Most of `init-hooks.ts` becomes dead code (Claude and Cursor hook writing removed). Keep only what's needed for non-plugin CLIs if any. The re-exported functions from `init.ts` can be cleaned up.

## Risks / Trade-offs

### R1: `agent-gauntlet` binary must be on PATH
Hooks reference `agent-gauntlet stop-hook` and `agent-gauntlet start-hook` by name. If the user installed via `npx` or a local `node_modules`, hooks won't fire. **Mitigation:** Document that global npm install is the supported installation method.

### R2: Claude plugin format stability
The `.claude-plugin/plugin.json` format and `claude plugin *` CLI commands are relatively new. Breaking changes could require updates. **Mitigation:** The wrapper module (`claude-cli.ts`) isolates all Claude CLI interactions to a single file.

### R3: Orphaned skill files after upgrade
Projects that previously ran `init` will have skills in `.claude/skills/` and hook entries in `settings.local.json`. These become orphaned after switching to the plugin model. **Mitigation:** Document in changelog. Don't auto-delete — users can clean up manually.

### R4: Codex still uses file copy
Codex has no plugin system, so it's still the old copy approach. Two code paths to maintain. **Mitigation:** Codex file-copy logic already exists and is stable. Scope is narrower (only Codex, not all CLIs).

## Migration Plan

1. Add `.claude-plugin/plugin.json` and `hooks/hooks.json` to package root
2. Update `package.json` `files` array
3. Add `src/plugin/claude-cli.ts` wrapper module
4. Add `src/commands/plugin-update.ts` shared update logic
5. Modify `init.ts` — add scope prompt, replace skill-copy with plugin install for Claude, add re-run delegation
6. Add `update` command registration in `src/index.ts`
7. Simplify `init-hooks.ts` — remove Claude/Cursor hook writing
8. Update release script to sync `.claude-plugin/plugin.json` version with `package.json`
9. Rollback: revert to previous init behavior (skill-copy + hook-write) if plugin approach has issues

## Open Questions

None — all resolved during design.
