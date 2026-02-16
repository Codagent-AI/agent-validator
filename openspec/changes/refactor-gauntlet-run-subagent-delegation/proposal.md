# Change: Refactor gauntlet-run skill to use subagent delegation

## Why

The `/gauntlet-run` skill fills the main agent's context window with large log files and JSON review output (including raw AI reviewer responses). This wastes context on ephemeral processing detail. By delegating file I/O to disposable subagents, the main agent only sees compact error summaries.

## Alternatives Considered

1. **CLI-side log summarization:** Add a `--summary` flag to the gauntlet CLI that outputs a compact error digest instead of full logs. This would solve the context problem without subagents, but requires modifying the tool's output format and wouldn't help with JSON status updates (the agent still needs to write back to JSON files).

2. **Single combined subagent:** Use one subagent for both extraction and update instead of two. Simpler but requires a round-trip: the subagent would need to pause mid-execution while the main agent fixes code, which isn't supported by the Task tool's synchronous model.

3. **Truncated file reading:** Have the main agent read only the last N lines of log files and skip the `rawOutput` field in JSON. Partial improvement but fragile — error context may be at the start of logs, and the agent still absorbs the violation data structures.

Subagent delegation was chosen because it fully isolates file contents from the main agent's context, works within existing tool capabilities, and doesn't require changes to the gauntlet CLI itself.

## What Changes

- The gauntlet-run skill template switches from direct file reading to a two-phase subagent pattern: EXTRACT (read log/json files, return compact summary) and UPDATE (write fix/skip decisions to review JSON files)
- The skill's `allowed-tools` adds `Task` alongside `Bash`
- Two new prompt template files (`extract-prompt.md`, `update-prompt.md`) are generated alongside `SKILL.md`
- The `buildGauntletSkillContent()` function in `init.ts` is updated to produce the new skill content and write the additional files
- An explicit safety constraint prevents the model from using `run_in_background: true` on subagent calls

## Impact

- Affected specs: `agent-command` (Issue Output Path Instructions, Issue Status Updates requirements are modified; Subagent Delegation Pattern, Subagent Safety Constraint, Subagent Prompt Template Files, and Gauntlet-Run Skill Allowed Tools requirements are added)
- Affected code: `src/commands/init.ts` (skill template generation), `.claude/skills/gauntlet-run/` (skill files)
- All projects using `agent-gauntlet init` will receive the updated skill on next init
