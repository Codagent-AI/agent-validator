## 0. Pre-factoring

`src/commands/init.ts` has Code Health 6.37 — Bumpy Road, Complex Method, Large Method in `promptAndInstallCommands` (cc=24, 158 LoC), `promptForConfig` (cc=18, 99 LoC), `registerInitCommand` (cc=11, 154 LoC), `installCommands` (cc=10).

- [x] 0.1 `src/commands/init.ts` (Code Health 6.37; Bumpy Road, Complex Method, Large Method) — refactor `promptAndInstallCommands` by extracting `promptAgentSelection` and the install-level prompt
- [x] 0.2 `src/commands/init.ts` (Code Health 6.37; Bumpy Road, Complex Method, Large Method) — refactor `registerInitCommand` by extracting `installSkill`, `installFlatCommand`, `installSkillsForAdapter`, `installFlatCommandsForAdapter`, `parseSelections` (merged from two duplicate functions), and `InstallContext` interface

## 1. Implementation

### Skill templates and structure

- [x] 1.1 Define `GAUNTLET_RUN_SKILL_CONTENT` constant in `src/commands/init.ts` via `buildGauntletSkillContent()` — migrate content from `src/templates/run_gauntlet.template.md` with proper YAML frontmatter (`name: gauntlet-run`, `description`, `disable-model-invocation: true`, `allowed-tools: Bash`). Written to `.claude/skills/gauntlet-run/SKILL.md` at install time.
- [x] 1.2 Define `GAUNTLET_CHECK_SKILL_CONTENT` constant in `src/commands/init.ts` — new skill, same workflow as gauntlet-run but instructions use `agent-gauntlet check` instead of `agent-gauntlet run`; only check failures (no review JSON handling needed). Written to `.claude/skills/gauntlet-check/SKILL.md`.
- [x] 1.3 Define `PUSH_PR_SKILL_CONTENT` constant in `src/commands/init.ts` — migrate from `src/templates/push_pr.template.md` with proper frontmatter (`name: gauntlet-push-pr`, `disable-model-invocation: true`). Written to `.claude/skills/gauntlet-push-pr/SKILL.md`.
- [x] 1.4 Define `FIX_PR_SKILL_CONTENT` constant in `src/commands/init.ts` — migrate from `src/templates/fix_pr.template.md` with proper frontmatter (`name: gauntlet-fix-pr`, `disable-model-invocation: true`). Written to `.claude/skills/gauntlet-fix-pr/SKILL.md`.
- [x] 1.5 Define `GAUNTLET_STATUS_SKILL_CONTENT` constant in `src/commands/init.ts` — instructions to run the bundled status script via `bun` and present the output. `name: gauntlet-status`, `allowed-tools: Bash, Read`, `disable-model-invocation: true`. Written to `.claude/skills/gauntlet-status/SKILL.md`.
- [x] 1.6 Create `.gauntlet/skills/gauntlet/status/scripts/status.ts` — TypeScript script that parses `gauntlet_logs/` (active) and `gauntlet_logs/previous/` (archived) to produce a structured session summary. Parse console logs, `.debug.log` (RUN_START, RUN_END, GATE_RESULT, STOP_HOOK events), and review JSON files. Output: iteration count, overall status, per-iteration stats (files changed, lines, gates, duration), violations fixed/skipped/outstanding, gate-level results.

### Init command updates

- [x] 1.7 Update `src/commands/init.ts` — define skill content as template constants (`GAUNTLET_RUN_SKILL_CONTENT`, `PUSH_PR_SKILL_CONTENT`, etc.) built via `buildGauntletSkillContent()` with YAML frontmatter. Add `gauntlet-check` and `gauntlet-status` templates. Skills are written directly to `.claude/skills/gauntlet-<action>/SKILL.md` via `installSkill()` using `fs.writeFile`.
- [x] 1.8 Implement `installSkill()` in `src/commands/init.ts` — for Claude adapter: create flat skill directories and write content directly via `fs.writeFile` to `.claude/skills/gauntlet-<action>/SKILL.md` (no symlinks). For non-Claude adapters: `installFlatCommand()` continues creating flat command files. Handle both project-level and user-level paths via `installSkillsForAdapter` / `installFlatCommandsForAdapter`.
- [x] 1.9 Update the CLI adapter interface if needed — check if Claude adapter needs `getProjectSkillDir`/`getUserSkillDir` methods for skill paths. The skill path for Claude is `.claude/skills/` (project) or `~/.claude/skills/` (user), vs the command path `.claude/commands/`.
- [x] 1.10 Ensure the status skill's `scripts/` subdirectory and script are included when installing skills (symlink the entire skill directory, or symlink SKILL.md and copy scripts)

### Dogfood skill (this project)

- [x] 1.11 Migrate `.claude/commands/dogfood.md` to `.claude/skills/gauntlet-run/SKILL.md` (project-level dogfood skill using flat directory structure, invoked as `/gauntlet-run`)

### Template cleanup

- [x] 1.12 Remove old template files from `src/templates/` (`run_gauntlet.template.md`, `push_pr.template.md`, `fix_pr.template.md`) and update any references to them
- [x] 1.13 Remove old canonical file creation from init (`.gauntlet/run_gauntlet.md`, `.gauntlet/push_pr.md`, `.gauntlet/fix_pr.md` in `.gauntlet/` root) — skill content now defined as template constants in `src/commands/init.ts`
- [x] 1.14 Update documentation — create `docs/skills-guide.md` (new), update `docs/user-guide.md` and `docs/quick-start.md` to reflect flat skill directory structure (`.claude/skills/gauntlet-<action>/SKILL.md`) and `/gauntlet-<action>` invocation pattern

## 2. Tests

- [x] 2.1 Test: init creates skill files under `.claude/skills/gauntlet-<action>/SKILL.md` with correct content for all 5 skills (gauntlet-run, gauntlet-check, gauntlet-push-pr, gauntlet-fix-pr, gauntlet-status)
- [x] 2.2 Test: init installs Claude skills as direct file writes (via `fs.writeFile`) under `.claude/skills/gauntlet-<action>/SKILL.md` (flat structure, no symlinks)
- [x] 2.3 Test: init installs non-Claude agent commands as flat files (existing behavior preserved)
- [x] 2.4 Test: gauntlet:check SKILL.md references `agent-gauntlet check` not `agent-gauntlet run`
- [x] 2.5 Test: gauntlet:status script parses sample console logs and debug logs correctly
- [x] 2.6 Test: gauntlet:status script falls back to `previous/` directory when no active logs exist
- [x] 2.7 Test: gauntlet:status script handles empty/missing log directories gracefully
- [x] 2.8 Test: all SKILL.md files have valid YAML frontmatter with required fields

## 3. Validation

If there is a "Pre-factoring" section above, confirm those refactorings are complete before marking the task complete.
If there is a "Manual Verification" section above, complete all verification steps before marking the task complete.

There are no automated validation tasks that need to be explicitly run. When work is completed, a stop hook should execute the full gauntlet of verification tasks and give direction on what needs to be fixed.
