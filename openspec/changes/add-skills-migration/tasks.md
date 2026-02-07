## 0. Pre-factoring

`src/commands/init.ts` has Code Health 6.37 — Bumpy Road, Complex Method, Large Method in `promptAndInstallCommands` (cc=24, 158 LoC), `promptForConfig` (cc=18, 99 LoC), `registerInitCommand` (cc=11, 154 LoC), `installCommands` (cc=10).

- [x] 0.1 Refactor `promptAndInstallCommands` in `src/commands/init.ts` — extract agent selection loop into a reusable `promptAgentSelection` function; extract install-level prompt into its own function
- [x] 0.2 Refactor `registerInitCommand` in `src/commands/init.ts` — extract skill file creation logic into a separate `scaffoldSkills` function

## 1. Implementation

### Skill templates and structure

- [x] 1.1 Create `.gauntlet/skills/gauntlet/run/SKILL.md` — migrate content from `src/templates/run_gauntlet.template.md` with proper YAML frontmatter (`name: run`, `description`, `disable-model-invocation: true`, `allowed-tools: Bash`)
- [x] 1.2 Create `.gauntlet/skills/gauntlet/check/SKILL.md` — new skill, same workflow as gauntlet:run but instructions use `agent-gauntlet check` instead of `agent-gauntlet run`; only check failures (no review JSON handling needed)
- [x] 1.3 Create `.gauntlet/skills/gauntlet/push-pr/SKILL.md` — migrate from `src/templates/push_pr.template.md` with proper frontmatter (`name: push-pr`, `disable-model-invocation: true`)
- [x] 1.4 Create `.gauntlet/skills/gauntlet/fix-pr/SKILL.md` — migrate from `src/templates/fix_pr.template.md` with proper frontmatter (`name: fix-pr`, `disable-model-invocation: true`)
- [x] 1.5 Create `.gauntlet/skills/gauntlet/status/SKILL.md` — instructions to run the bundled status script via `bun` and present the output. `name: status`, `allowed-tools: Bash, Read`, model invocation enabled.
- [x] 1.6 Create `.gauntlet/skills/gauntlet/status/scripts/status.ts` — TypeScript script that parses `gauntlet_logs/` (active) and `gauntlet_logs/previous/` (archived) to produce a structured session summary. Parse console logs, `.debug.log` (RUN_START, RUN_END, GATE_RESULT, STOP_HOOK events), and review JSON files. Output: iteration count, overall status, per-iteration stats (files changed, lines, gates, duration), violations fixed/skipped/outstanding, gate-level results.

### Init command updates

- [x] 1.7 Update `src/commands/init.ts` — change template content constants to use new SKILL.md format with YAML frontmatter. Add `gauntlet:check` and `gauntlet:status` templates. Update paths from `.gauntlet/run_gauntlet.md` to `.gauntlet/skills/gauntlet/run/SKILL.md`, etc.
- [x] 1.8 Update `installSingleCommand` / `installCommands` in `src/commands/init.ts` — for Claude adapter: create nested skill directories (`.claude/skills/gauntlet/<action>/SKILL.md` with symlink to `.gauntlet/skills/gauntlet/<action>/SKILL.md`). For non-Claude adapters: continue creating flat command files. Handle both project-level and user-level paths.
- [x] 1.9 Update the CLI adapter interface if needed — check if Claude adapter needs `getProjectSkillDir`/`getUserSkillDir` methods for skill paths. The skill path for Claude is `.claude/skills/` (project) or `~/.claude/skills/` (user), vs the command path `.claude/commands/`.
- [x] 1.10 Ensure the status skill's `scripts/` subdirectory and script are included when installing skills (symlink the entire skill directory, or symlink SKILL.md and copy scripts)

### Dogfood skill (this project)

- [x] 1.11 Migrate `.claude/commands/dogfood.md` to `.claude/skills/gauntlet/run/SKILL.md` (project-level skill that is the symlink target or direct override of the canonical `.gauntlet/skills/gauntlet/run/SKILL.md`)

### Template cleanup

- [x] 1.12 Remove old template files from `src/templates/` (`run_gauntlet.template.md`, `push_pr.template.md`, `fix_pr.template.md`) and update any references to them
- [x] 1.13 Remove old canonical file creation from init (`.gauntlet/run_gauntlet.md`, `.gauntlet/push_pr.md`, `.gauntlet/fix_pr.md` in `.gauntlet/` root) — these move to `.gauntlet/skills/gauntlet/`

## 2. Tests

- [x] 2.1 Test: init creates skill directories under `.gauntlet/skills/gauntlet/` with correct SKILL.md files for all 5 skills
- [x] 2.2 Test: init installs Claude skills as symlinked directories under `.claude/skills/gauntlet/`
- [x] 2.3 Test: init installs non-Claude agent commands as flat files (existing behavior preserved)
- [x] 2.4 Test: gauntlet:check SKILL.md references `agent-gauntlet check` not `agent-gauntlet run`
- [x] 2.5 Test: gauntlet:status script parses sample console logs and debug logs correctly
- [x] 2.6 Test: gauntlet:status script falls back to `previous/` directory when no active logs exist
- [x] 2.7 Test: gauntlet:status script handles empty/missing log directories gracefully
- [x] 2.8 Test: all SKILL.md files have valid YAML frontmatter with required fields

## 3. Validation

If there is a "Manual Verification" section above, complete all verification steps before marking the task complete.

There are no automated validation tasks that need to be explicitly run. When work is completed, a stop hook should execute the full gauntlet of verification tasks and give direction on what needs to be fixed.
