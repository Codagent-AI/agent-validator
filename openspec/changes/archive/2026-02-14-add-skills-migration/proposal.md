# Change: Migrate agent commands to Claude Code skills and add new skills

## Why
Agent Gauntlet currently installs flat `.md` command files into `.claude/commands/` for each CLI agent. Claude Code has moved to a directory-based skills model (`.claude/skills/<name>/SKILL.md`) that supports frontmatter-based invocation control, bundled scripts, and supporting files. Migrating to skills enables the new `/gauntlet-status` skill (which needs a bundled log-parsing script) and aligns with the modern Claude Code extension model. Additionally, users need a `/gauntlet-check` skill for running checks-only without reviews.

## What Changes
- Migrate existing command templates (`run_gauntlet`, `push_pr`, `fix_pr`) from flat `.md` files to skill directories with `SKILL.md` + frontmatter
- Use flat `gauntlet-<action>/` directory structure under `.claude/skills/` for invocation as `/gauntlet-run`, `/gauntlet-push-pr`, `/gauntlet-fix-pr` (colon-namespaced invocation via nested directories does NOT work for project-level skills in Claude Code)
- Add new `/gauntlet-check` skill — same workflow as `/gauntlet-run` but invokes `agent-gauntlet check` (checks only, no reviews)
- Add new `/gauntlet-status` skill with a bundled TypeScript script that parses `gauntlet_logs/` (and `gauntlet_logs/previous/`) to produce a structured summary of the most recent gauntlet session
- Update `init` command to install skills instead of commands (new directory structure, skills written directly to adapter-specific paths — no symlinks)
- Update the dogfood command (`.claude/commands/dogfood.md`) to the new skills format
- The `name` field in each skill's frontmatter uses `gauntlet-<action>` (e.g., `name: gauntlet-run`)

## Impact
- Affected specs: `agent-command`, `init-hook-install`
- Affected code:
  - `src/commands/init.ts` — install skills instead of commands
  - `src/templates/` — skill content built inline via `buildGauntletSkillContent()` and `SKILL_DEFINITIONS`
  - `.claude/commands/dogfood.md` → `.claude/skills/gauntlet-run/SKILL.md`
  - New: `.gauntlet/skills/gauntlet/status/scripts/status.ts` (bundled log-parsing script, NOT a Claude skill path)
  - New: `.claude/skills/gauntlet-check/SKILL.md` (check-only skill)
  - New: `.claude/skills/gauntlet-status/SKILL.md` + bundled script
- Affected documentation:
  - `docs/skills-guide.md` — new guide covering skills usage and invocation
  - `docs/user-guide.md` — updated to reflect skills-based workflow
  - `docs/quick-start.md` — updated to reference `/gauntlet-run` invocation
