## Context
Agent Gauntlet currently installs flat `.md` command files into `.claude/commands/`, `.gemini/commands/`, etc. Claude Code now supports a richer skills model (`.claude/skills/<name>/SKILL.md`) with directory-based structure, YAML frontmatter, and bundled resources. We want to migrate to skills and add two new capabilities: `/gauntlet:check` and `/gauntlet:status`.

Claude Code derives colon-namespaced skill names from nested directories. For example, `.claude/commands/openspec/proposal.md` becomes `/openspec:proposal`. The same pattern works for skills: `.claude/skills/gauntlet/run/SKILL.md` becomes `/gauntlet:run`.

## Goals / Non-Goals

### Goals
- Migrate all existing commands to skills format with proper frontmatter
- Use nested `gauntlet/<action>/` directories to get colon-namespaced invocation: `/gauntlet:run`, `/gauntlet:check`, etc.
- New `/gauntlet:check` skill for checks-only workflow
- New `/gauntlet:status` skill with bundled script for log parsing
- Update `init` to install skills instead of commands
- Keep backward compatibility: existing `.claude/commands/` installs continue to work (users can migrate on next `init`)

### Non-Goals
- Auto-migration of existing command installs (users re-run `init`)
- Supporting skill installation for non-Claude agents (Gemini/Codex don't support the skills model; they keep using commands)
- Rewriting the log parser — reuse existing `reconstructHistory` and debug log parsing

## Decisions

### Skill naming: `gauntlet:` namespace via nested directories
Claude Code derives colon-namespaced names from nested directory structures. The pattern `.claude/skills/gauntlet/run/SKILL.md` registers as `/gauntlet:run`. This matches the existing convention used by plugins (e.g., `openspec:proposal`, `commit-commands:commit`).

The canonical files live at `.gauntlet/skills/gauntlet/<action>/SKILL.md` and are symlinked into `.claude/skills/gauntlet/<action>/SKILL.md`.

### Skill directory layout

```
.gauntlet/skills/gauntlet/              # Canonical skill files (in repo)
├── run/
│   └── SKILL.md                        # Run template (migrated from run_gauntlet.md)
├── check/
│   └── SKILL.md                        # Check template (new)
├── push-pr/
│   └── SKILL.md                        # Push PR template (migrated from push_pr.md)
├── fix-pr/
│   └── SKILL.md                        # Fix PR template (migrated from fix_pr.md)
└── status/
    ├── SKILL.md                        # Status skill instructions
    └── scripts/
        └── status.ts                   # Log parsing script
```

Installed into target projects via symlink (Claude) or file copy (other agents):
```
.claude/skills/gauntlet/run/SKILL.md      → symlink → .gauntlet/skills/gauntlet/run/SKILL.md
.claude/skills/gauntlet/check/SKILL.md    → symlink → .gauntlet/skills/gauntlet/check/SKILL.md
.claude/skills/gauntlet/push-pr/SKILL.md  → symlink → .gauntlet/skills/gauntlet/push-pr/SKILL.md
.claude/skills/gauntlet/fix-pr/SKILL.md   → symlink → .gauntlet/skills/gauntlet/fix-pr/SKILL.md
.claude/skills/gauntlet/status/SKILL.md   → symlink → .gauntlet/skills/gauntlet/status/SKILL.md
```

For non-Claude agents that don't support skills, continue installing as flat command files in their respective command directories (`.gemini/commands/`, `.codex/commands/`). These keep the `gauntlet` name (no colon namespacing since those agents don't support it).

### Status skill: bundled TypeScript script
The `/gauntlet:status` skill bundles a `scripts/status.ts` script that:
1. Reads `gauntlet_logs/` for active session logs (console.*.log, review JSON files)
2. Falls back to `gauntlet_logs/previous/` if no active logs exist
3. Parses `.debug.log` for structured run data (RUN_START, RUN_END, GATE_RESULT, STOP_HOOK entries)
4. Outputs a structured summary including:
   - Run count (iterations) and overall status
   - Per-iteration: files changed, lines added/removed, gates run, duration
   - Failures fixed, skipped, and outstanding
   - Gate-level results (which checks/reviews passed/failed)
   - Stop hook activity summary
5. The skill's SKILL.md instructs Claude to run the script via `bun` and present the output

**Alternative considered**: Having Claude read and parse raw log files directly. Rejected because log formats are complex (JSON reviews, debug log line format, multiple files per run) and parsing them would waste context tokens. A script produces a clean summary.

### Init command changes
The `installCommands` function in `init.ts` becomes `installSkills`:
- For Claude: creates nested skill directories with SKILL.md symlinks pointing to `.gauntlet/skills/gauntlet/`
- For non-Claude agents: continues creating flat command files in their command directories
- Canonical files move from `.gauntlet/run_gauntlet.md` to `.gauntlet/skills/gauntlet/run/SKILL.md`
- Template content in `init.ts` gets proper YAML frontmatter (`name`, `description`, `disable-model-invocation`, `allowed-tools`)

### Frontmatter for each skill

| Skill | `name` | `disable-model-invocation` | `allowed-tools` | Rationale |
|-------|--------|---------------------------|-----------------|-----------|
| run | `run` | `true` | `Bash` | User-triggered only; has side effects |
| check | `check` | `true` | `Bash` | User-triggered only; same rationale as run |
| push-pr | `push-pr` | `true` | `Bash` | User-triggered only; pushes code |
| fix-pr | `fix-pr` | `true` | `Bash` | User-triggered only; modifies code |
| status | `status` | `false` | `Bash, Read` | Claude can auto-invoke when user asks about gauntlet status |

Note: The `name` field does not need the `gauntlet:` prefix since the directory nesting provides the namespace automatically.

## Risks / Trade-offs

### Risk: Non-Claude agents lose feature parity
Gemini and Codex don't support the skills directory model. They continue using flat command files, which means they won't get the status skill's bundled script.
**Mitigation**: The status script can be invoked directly via `bun .gauntlet/skills/gauntlet/status/scripts/status.ts` from any agent's command template. Non-Claude agents' gauntlet command can include a note about this.

### Risk: Symlink depth changes
Current symlinks are one level: `.claude/commands/gauntlet.md` → `../../.gauntlet/run_gauntlet.md`. New symlinks are deeper: `.claude/skills/gauntlet/run/SKILL.md` → `../../../../.gauntlet/skills/gauntlet/run/SKILL.md`.
**Mitigation**: Use `path.relative()` to compute correct symlink targets, same as current approach.

### Risk: Existing installs don't auto-migrate
Users with existing `.claude/commands/gauntlet.md` won't automatically get the new skills.
**Mitigation**: Document in changelog. The old commands continue to work. Users can re-run init or manually install.

## Open Questions
- Should init remove old `.claude/commands/gauntlet.md` if it detects an upgrade? (Recommendation: no — too risky, let users clean up)
