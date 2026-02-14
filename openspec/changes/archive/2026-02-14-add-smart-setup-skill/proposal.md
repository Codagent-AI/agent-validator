# Change: Add Smart Setup Skill

## Why
The current `init` command is a dumb CLI questionnaire that only offers lint and test checks. Users must know the exact commands to run and manually specify them. Since agent-gauntlet is designed for AI coding agents, setup should leverage the agent itself to intelligently scan a project, discover all available static checks, and configure them — regardless of language or toolchain.

## What Changes
- **Simplify `init`**: Remove interactive config prompting (base branch, source dir, lint/test commands). Keep only CLI selection prompt. Auto-detect base branch. Write config skeleton with empty `entry_points`.
- **Auto-install stop hooks**: When Claude Code or Cursor is among the selected CLIs, automatically install the stop hook (no prompt). Claude Code: `.claude/settings.local.json`. Cursor: `.cursor/hooks.json`.
- **Add `/gauntlet-setup` skill**: New agent skill that scans a project for tooling signals (build, lint, typecheck, test, security), presents findings, and creates check YAML files + configures `entry_points`. Works for fresh setup, adding checks to existing config, and custom check/review additions.
- **Add check catalog reference**: Reference file documenting check categories, YAML schema, and examples for the agent to use during setup.
- **Always include built-in reviewer**: Fresh setup always adds the `code-quality` review to entry points. Default `num_reviews` reduced from 2 to 1 — one review pass is sufficient for the built-in code-quality reviewer and keeps initial runs faster.

## Alternatives Considered
1. **Enhance `init` with auto-detection (no skill)**: Make `init` itself scan for tools and generate config. Rejected because the scanning requires reasoning about project structure (which linter config maps to which command, which test runner to use) — that's what an AI agent is good at, not a deterministic script.
2. **Standalone `agent-gauntlet setup` CLI command**: A new CLI command that does the scanning. Rejected because it would duplicate the agent's capabilities — the agent already has file reading, project understanding, and conversational abilities. A skill leverages what's already there.
3. **Hybrid: init does basic detection, skill handles advanced**: `init` auto-detects obvious checks (package.json scripts), skill handles the rest. Rejected as unnecessary complexity — the skill can do all of it, and keeping `init` simple reduces maintenance.

## Impact
- Affected specs: `init-hook-install` (stop hook prompt removed, auto-install added, Cursor hook install added), `init-config` (new — config skeleton, prompt removal, next-step message), `agent-command` (setup skill installation, project scanning & configuration flows, custom additions, check catalog reference)
- Affected code: `src/commands/init.ts` (major simplification), new skill files
- Affected docs: `docs/user-guide.md` (new init workflow, setup skill), `docs/config-reference.md` (empty entry_points), `docs/quick-start.md` (simplified flow), `docs/skills-guide.md` (new skill listing)
