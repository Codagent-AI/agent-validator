# Change: Add Gauntlet Auto-Invocation

## Why
The gauntlet-run skill has `disable-model-invocation: true` and a vague description, so the agent never auto-invokes it. The stop hook is the only enforcement mechanism but it's complex and disabled by default. We need a reliable way for agents to self-invoke the gauntlet as the final verification step after coding tasks.

## What Changes
- Update gauntlet-run skill frontmatter: set `disable-model-invocation: false` and provide a clear, actionable description so Claude's auto-invocation logic knows when to trigger it
- Add a new `agent-gauntlet start-hook` CLI command that outputs context injection JSON at session start, priming the agent with explicit instructions to run `/gauntlet-run` before reporting work as complete
- Install start hooks for Claude Code (`SessionStart`) and Cursor (`sessionStart`) during `agent-gauntlet init`
- Add `installStartHook()` and `installCursorStartHook()` functions mirroring the existing stop hook installers

## Alternatives Considered

1. **CLAUDE.md-only approach**: Add instructions to CLAUDE.md telling the agent to run `/gauntlet-run`. Simpler but fragile — CLAUDE.md is loaded once and can be forgotten in long sessions. Not portable across IDE CLIs. Rejected because it doesn't work for Cursor and has no structured injection mechanism.

2. **Skill description change only (no start hook)**: Just update the frontmatter to enable auto-invocation with a clear description. This is the minimal approach and may be sufficient for Claude Code where skill auto-invocation is well-supported. Rejected as the sole mechanism because: (a) auto-invocation behavior is not guaranteed by any spec, (b) it doesn't work for Cursor which has no equivalent skill auto-invocation, and (c) we want defense in depth.

3. **Enable stop hook by default**: Change the default `stop_hook.enabled` from `false` to `true` so enforcement happens automatically. Rejected because the stop hook is a blocking mechanism that can trap agents in retry loops — it's appropriate as an opt-in safety net, not a default behavior.

The chosen two-mechanism approach (skill frontmatter + start hook) provides defense in depth: the skill description enables auto-invocation as the primary trigger, while the start hook provides belt-and-suspenders priming that works across all supported CLIs.

## Impact
- Affected specs: `init-hook-install`, `agent-command`, `start-hook` (new capability)
- Affected code: `src/commands/init.ts`, `src/commands/start-hook.ts` (new), `src/commands/index.ts`, `src/index.ts`, `.claude/skills/gauntlet-run/SKILL.md`
- **Note:** `add-smart-setup-skill` change also modifies `init.ts` hook installation flow — sequence this change first
