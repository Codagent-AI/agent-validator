## Why

The `init` command installs gauntlet skills to `.claude/skills/` for all agents, but Codex has its own native skill system at `.agents/skills/`. Codex users currently must reference skills via `@.claude/skills/<name>/SKILL.md` — a Claude-specific path that's unintuitive and doesn't integrate with Codex's skill discovery. Since both systems use compatible `SKILL.md` formats, we can install skills to both locations and give Codex users first-class skill support.

Additionally, when multiple skills have changed across a version bump, the user must answer each overwrite prompt individually with no batch shortcut.

## What Changes

- Update `CodexAdapter.getProjectSkillDir()` to return `.agents/skills` instead of `null`
- Extend skill installation in `init` to also install skills to `.agents/skills/` when codex is selected as a dev CLI
- Update post-init instructions to show Codex-native skill references instead of `@.claude/skills/` paths
- Apply the same checksum-based update logic to the Codex skill directory
- **New feature**: Add "update all" option to the skill overwrite prompt, allowing users to accept all remaining skill updates at once

## Capabilities

### Modified Capabilities

- `init-config`: Init installs skills to `.agents/skills/` when codex is a selected dev CLI, prints Codex-native post-init instructions, and supports "update all" shortcut in overwrite prompts

## Impact

- **Code**: `src/cli-adapters/codex.ts` (adapter methods), `src/commands/init.ts` (skill installation + post-init output), `src/commands/init-prompts.ts` (overwrite prompt UX)
- **Files created at init**: `.agents/skills/gauntlet-*/` directories in user projects (when codex selected)
- **Dependencies**: None — uses same SKILL.md format, no transformation needed
- **Breaking changes**: None — existing `.claude/skills/` installation unchanged, overwrite prompt adds options but defaults remain the same
