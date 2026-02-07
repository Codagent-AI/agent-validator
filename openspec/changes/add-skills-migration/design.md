## Context
Agent Gauntlet currently installs flat `.md` command files into `.claude/commands/`, `.gemini/commands/`, etc. Claude Code now supports a richer skills model (`.claude/skills/<name>/SKILL.md`) with directory-based structure, YAML frontmatter, and bundled resources. We want to migrate to skills and add two new capabilities: `/gauntlet-check` and `/gauntlet-status`.

Claude Code project-level skills are only one level deep: `.claude/skills/<name>/SKILL.md` works, but `.claude/skills/namespace/<name>/SKILL.md` does **not**. The colon-namespaced pattern (e.g., `openspec:proposal`) works for installed plugins, not project-level skills. Therefore, skills use flat hyphenated names like `gauntlet-run`, `gauntlet-check`, etc.

## Goals / Non-Goals

### Goals
- Migrate all existing commands to skills format with proper frontmatter
- Use flat `gauntlet-<action>/` directories for hyphenated invocation: `/gauntlet-run`, `/gauntlet-check`, etc.
- New `/gauntlet-check` skill for checks-only workflow
- New `/gauntlet-status` skill with bundled script for log parsing
- Update `init` to install skills instead of commands
- Keep backward compatibility: existing `.claude/commands/` installs continue to work (users can migrate on next `init`)

### Non-Goals
- Auto-migration of existing command installs (users re-run `init`)
- Supporting skill installation for non-Claude agents (Gemini/Codex don't support the skills model; they keep using commands)
- Rewriting the log parser — reuse existing `reconstructHistory` and debug log parsing

## Pre-factoring

Before modifying `src/commands/init.ts` for skill installation, the file had a Code Health score of **6.37** (yellow / problematic technical debt). CodeScene identified the following code smells:

- **Bumpy Road Ahead** in several functions
- **Complex Method**: `promptAndInstallCommands` (cc=24), and other functions with cc=18, cc=11, cc=10
- **Large Method**: `promptAndInstallCommands` exceeded recommended size

Refactoring strategy applied before adding skill logic:
1. **Extract `promptAgentSelection`** from `promptAndInstallCommands` to separate the interactive agent-selection flow from the install logic, reducing cyclomatic complexity of the parent function.
2. **Extract `parseSelections`** to deduplicate `parseAdapterSelections` and `parseAgentSelections`, which contained nearly identical parsing logic for multiselect prompt results.
3. **Introduce `InstallContext`** interface to bundle repeated function arguments (`projectRoot`, `isUserLevel`, `gauntletDir`) into a single object, reducing parameter counts across install helper functions.

Rationale: Reducing complexity before modifying `init.ts` for skill installation made the subsequent changes safer, easier to review, and less likely to introduce regressions.

## Decisions

### Skill naming: flat `gauntlet-<action>/` directories
Claude Code project-level skills are one level deep only. Nested directories like `.claude/skills/gauntlet/run/SKILL.md` do **not** produce colon-namespaced names; they simply fail to register. The colon-namespace pattern (e.g., `openspec:proposal`) only works for installed plugins, not project-level skills.

Instead, each skill uses a flat hyphenated directory name: `.claude/skills/gauntlet-run/SKILL.md`, `.claude/skills/gauntlet-check/SKILL.md`, etc. The `name` field in YAML frontmatter must include the full `gauntlet-` prefix (e.g., `name: gauntlet-run`) since there is no directory nesting to provide a namespace.

Skill content is stored as template constants in `src/commands/init.ts` (`buildGauntletSkillContent`, `PUSH_PR_SKILL_CONTENT`, `FIX_PR_SKILL_CONTENT`, `GAUNTLET_STATUS_SKILL_CONTENT`) and written directly to disk via `fs.writeFile` in the `installSkill` function.

### Skill directory layout

Template content lives as constants in `src/commands/init.ts`:
```
src/commands/init.ts
├── buildGauntletSkillContent("run")     # → GAUNTLET_RUN_SKILL_CONTENT
├── buildGauntletSkillContent("check")   # → GAUNTLET_CHECK_SKILL_CONTENT
├── PUSH_PR_SKILL_CONTENT                # Inline template constant
├── FIX_PR_SKILL_CONTENT                 # Inline template constant
├── GAUNTLET_STATUS_SKILL_CONTENT        # Inline template constant
└── SKILL_DEFINITIONS[]                  # Maps action → content
```

Installed into target projects via direct file write (`fs.writeFile` in `installSkill`):
```
.claude/skills/gauntlet-run/SKILL.md       # Written by installSkill
.claude/skills/gauntlet-check/SKILL.md     # Written by installSkill
.claude/skills/gauntlet-push-pr/SKILL.md   # Written by installSkill
.claude/skills/gauntlet-fix-pr/SKILL.md    # Written by installSkill
.claude/skills/gauntlet-status/SKILL.md    # Written by installSkill
```

The status skill's bundled script lives at a separate path:
```
.gauntlet/skills/gauntlet/status/scripts/status.ts   # Log parsing script
```

For non-Claude agents that don't support skills, continue installing as flat command files in their respective command directories (`.gemini/commands/`, `.codex/commands/`). These use the `gauntlet` name prefix (no namespacing since those agents don't support it).

### Status skill: bundled TypeScript script
The `/gauntlet-status` skill bundles a `scripts/status.ts` script that:
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
The `installCommands` flow in `init.ts` now uses `installSkillsForAdapter` and `installSkill`:
- For Claude: `installSkill` creates a flat `gauntlet-<action>/` directory under `.claude/skills/` and writes `SKILL.md` directly via `fs.writeFile`
- For non-Claude agents: `installFlatCommand` continues creating flat command files in their command directories (`.gemini/commands/`, `.codex/commands/`)
- Template content is stored as constants in `init.ts` (`buildGauntletSkillContent`, `PUSH_PR_SKILL_CONTENT`, `FIX_PR_SKILL_CONTENT`, `GAUNTLET_STATUS_SKILL_CONTENT`) and assembled via `SKILL_DEFINITIONS`
- All skill content includes proper YAML frontmatter (`name`, `description`, `disable-model-invocation`, `allowed-tools`)

### Frontmatter for each skill

| Skill | `name` | `disable-model-invocation` | `allowed-tools` | Rationale |
|-------|--------|---------------------------|-----------------|-----------|
| run | `gauntlet-run` | `true` | `Bash` | User-triggered only; has side effects |
| check | `gauntlet-check` | `true` | `Bash` | User-triggered only; same rationale as run |
| push-pr | `gauntlet-push-pr` | `true` | `Bash` | User-triggered only; pushes code |
| fix-pr | `gauntlet-fix-pr` | `true` | `Bash` | User-triggered only; modifies code |
| status | `gauntlet-status` | `true` | `Bash, Read` | User-triggered only; reads logs |

Note: The `name` field must include the `gauntlet-` prefix because project-level skills use flat directory names (`gauntlet-run/`, `gauntlet-check/`, etc.) with no nesting to provide a namespace. The `name` in frontmatter becomes the `/slash-command` directly.

## Risks / Trade-offs

### Risk: Non-Claude agents lose feature parity
Gemini and Codex don't support the skills directory model. They continue using flat command files, which means they won't get the status skill's bundled script.
**Mitigation**: The status script can be invoked directly via `bun .gauntlet/skills/gauntlet/status/scripts/status.ts` from any agent's command template. Non-Claude agents' gauntlet command can include a note about this.

### Risk: Template content duplication
Skill content is stored as string constants in `init.ts` rather than as canonical files on disk. Changes to skill instructions must be made in `init.ts`, not in separate `.md` files.
**Mitigation**: The `SKILL_DEFINITIONS` array and builder functions (`buildGauntletSkillContent`) centralize all skill content in one file. The dogfood copies in `.claude/skills/gauntlet-*/SKILL.md` serve as the living reference for the agent-gauntlet project itself.

### Risk: Existing installs don't auto-migrate
Users with existing `.claude/commands/gauntlet.md` won't automatically get the new skills.
**Mitigation**: Document in changelog. The old commands continue to work. Users can re-run init or manually install.

## Open Questions
- Should init remove old `.claude/commands/gauntlet.md` if it detects an upgrade? (Recommendation: no — too risky, let users clean up)
