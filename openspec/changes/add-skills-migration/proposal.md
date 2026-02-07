# Change: Migrate agent commands to Claude Code skills and add new skills

## Why
Agent Gauntlet currently installs flat `.md` command files into `.claude/commands/` for each CLI agent. Claude Code has moved to a directory-based skills model (`.claude/skills/<name>/SKILL.md`) that supports frontmatter-based invocation control, bundled scripts, and supporting files. Migrating to skills enables the new `/gauntlet:status` skill (which needs a bundled log-parsing script) and aligns with the modern Claude Code extension model. Additionally, users need a `/gauntlet:check` skill for running checks-only without reviews.

## What Changes
- Migrate existing command templates (`run_gauntlet`, `push_pr`, `fix_pr`) from flat `.md` files to skill directories with `SKILL.md` + frontmatter
- Use nested `gauntlet/<action>/` directory structure to get colon-namespaced invocation: `/gauntlet:run`, `/gauntlet:push-pr`, `/gauntlet:fix-pr`
- Add new `/gauntlet:check` skill — same workflow as `/gauntlet:run` but invokes `agent-gauntlet check` (checks only, no reviews)
- Add new `/gauntlet:status` skill with a bundled TypeScript script that parses `gauntlet_logs/` (and `gauntlet_logs/previous/`) to produce a structured summary of the most recent gauntlet session
- Update `init` command to install skills instead of commands (new directory structure, symlinks into skill dirs)
- Update the dogfood command (`.claude/commands/dogfood.md`) to the new skills format

## Impact
- Affected specs: `agent-command`, `init-hook-install`
- Affected code:
  - `src/commands/init.ts` — install skills instead of commands
  - `src/templates/` — move to `.gauntlet/skills/gauntlet/` directory format
  - `.claude/commands/dogfood.md` → `.claude/skills/gauntlet/run/SKILL.md`
  - New: `.gauntlet/skills/gauntlet/status/scripts/status.ts` (log summary script)
  - New: `.gauntlet/skills/gauntlet/check/SKILL.md` (check-only skill)
  - New: `.gauntlet/skills/gauntlet/status/SKILL.md` + bundled script
