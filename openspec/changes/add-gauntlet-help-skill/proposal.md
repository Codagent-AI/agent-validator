# Change: Add gauntlet-help diagnostic skill

## Why
Users need a first-class way to diagnose and explain gauntlet behavior from inside their agent session, especially for common questions like:
- "The hook reported no changes, why?"
- "What validation checks are configured for this project?"
- "What happened in the last stop-hook run?"

This is currently possible by manually inspecting config and logs, but it is inconsistent and requires gauntlet internals knowledge. The new skill should make diagnostics predictable and evidence-based.

A key constraint is that installed users may not have source code access. The skill must therefore diagnose from runtime artifacts and CLI outputs, not implementation files.

## What Changes
- Add a new `/gauntlet-help` skill focused on diagnosis (not auto-fixing)
- Keep the skill prompt-only (no bundled scripts)
- Include evidence sources and output contract directly in `SKILL.md` (always needed for every invocation)
- Add situation-based reference files under `references/` organized by troubleshooting domain (stop-hook, config, gates, locks, adapters, CI/PR) so only the relevant reference is loaded per question
- Require the skill to resolve `log_dir` from `.gauntlet/config.yml` before reading logs
- Require the skill to use runtime evidence sources, including:
  - `<log_dir>/.debug.log`
  - `<log_dir>/.execution_state`
  - gate logs and review JSON in `<log_dir>/`
  - CLI outputs (`agent-gauntlet list`, `agent-gauntlet health`, `agent-gauntlet detect`) when needed
- Cover all troubleshooting domains: stop-hook statuses, config/setup, gate failures, lock conflicts, adapter health, and CI/PR integration
- Update init installation so Claude skill installs include `gauntlet-help`

## Impact
- Affected specs:
  - `agent-command` (ADDED requirements for gauntlet-help behavior and structure)
  - `init-hook-install` (ADDED requirement for gauntlet-help installation behavior)
- Affected code (expected):
  - `src/commands/init.ts` (include/install gauntlet-help bundle for Claude)
  - skill files for gauntlet-help (`SKILL.md` + 6 situation-based `references/*.md` files)
- Affected documentation (expected):
  - `docs/skills-guide.md`
  - any relevant quick-start/user-guide sections referencing available skills
