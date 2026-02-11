# Smart Setup Skill

## Problem

The current `init` command is a "dumb" interactive CLI questionnaire that only offers lint and test checks. Users must know exactly what commands to run and manually specify them. Since agent-gauntlet is used with AI coding agents, the setup should leverage the agent itself to intelligently scan a project and configure the right checks — regardless of language or toolchain.

## Design

Split setup into two phases:

1. **`init` (CLI, deterministic)** — Handles mechanical setup: CLI detection, directory creation, config skeleton, skill installation, auto-installs stop hook for supported CLIs.
2. **`/gauntlet-setup` (Agent Skill, AI-driven)** — Scans the project, discovers tooling, suggests checks, creates check YAML files, and configures `entry_points` in `config.yml`.

### Phase 1: Simplified `init`

**What it does:**

1. Detect available CLIs (unchanged)
2. **Prompt: which CLIs to use** (keep current interactive flow)
3. Auto-detect base branch (default `origin/main`)
4. Create `.gauntlet/` directory with subdirectories (`checks/`, `reviews/`)
5. Write `config.yml` with everything **except** `entry_points`:
   ```yaml
   base_branch: origin/main
   log_dir: gauntlet_logs
   cli:
     default_preference: [claude, gemini]
     adapters:
       claude:
         allow_tool_use: false
         thinking_budget: high
   # entry_points configured by /gauntlet-setup
   entry_points: []
   ```
6. Create `reviews/code-quality.yml` referencing the built-in reviewer:
   ```yaml
   builtin: code-quality
   num_reviews: 1
   ```
7. Install skills/commands for selected CLIs (unchanged logic)
8. Copy status script bundle (unchanged)
9. **Auto-install stop hook** — If Claude Code or Cursor is among the selected CLIs, automatically install the stop hook for each (no prompt). Claude Code: writes to `.claude/settings.local.json`. Cursor: writes to `.cursor/hooks.json`. Show a dimmed/skipped message if hook already installed.
10. Print: `"Run /gauntlet-setup to configure your checks and reviews"`

**What gets removed from `init`:**

- `promptForConfig()` — replaced by the single retained prompt (CLI selection)
- `generateConfigYml()` — replaced by simpler template (no entry_points)
- Lint/test command prompts — replaced by the setup skill
- `promptAndInstallStopHook()` — replaced by automatic installation (no prompt)
- `InitConfig` interface — simplified
- `--yes` flag behavior — still skips CLI selection prompt (uses all CLIs), stop hook auto-installs regardless

### Phase 2: `/gauntlet-setup` Skill

A new skill installed at `.claude/skills/gauntlet-setup/SKILL.md` with a `references/check-catalog.md` reference file.

#### SKILL.md

Instructs the agent to:

1. **Check existing config** — Read `.gauntlet/config.yml`.
   - If `entry_points` is empty (fresh setup): proceed to step 2 (full scan).
   - If `entry_points` is populated (existing setup): show a summary of current entry points and checks, then ask the user:
     - **Add checks** — Scan for tools not already configured and suggest additions (proceed to step 2, filtering out existing checks)
     - **Add custom** — User describes what they want to add (skip to step 5)
     - **Reconfigure** — Start fresh: back up existing check files, clear entry_points, proceed to step 2

2. **Scan the project** — Look for tooling signals across these check categories:
   - **Build** — Build scripts, compiled languages
   - **Lint** — Linters, formatters
   - **Typecheck** — Static type checkers
   - **Test** — Test runners, test directories
   - **Security (deps)** — Dependency audit tools
   - **Security (code)** — Static analysis / SAST tools

   Signals to look for:
   - `package.json` (scripts, devDependencies)
   - `Makefile`, `Taskfile.yml`, `justfile`
   - `Cargo.toml`, `pyproject.toml`, `go.mod`, `build.gradle`, `pom.xml`
   - Config files (`.eslintrc`, `biome.json`, `ruff.toml`, `.golangci.yml`, `tsconfig.json`, etc.)
   - CI workflow files (`.github/workflows/`) for command hints

   For the "add checks" path, filter out checks that are already configured.

3. **Present findings** — Show a table of discovered checks:
   ```
   Category      | Tool          | Command              | Confidence
   --------------|---------------|----------------------|-----------
   Build         | npm           | npm run build        | High
   Lint          | ESLint        | npx eslint .         | High
   Typecheck     | TypeScript    | npx tsc --noEmit     | High
   Test          | Jest          | npm test             | High
   Security-deps | npm audit     | npm audit            | Medium
   Security-code | (not found)   | —                    | —
   ```

4. **Ask user to confirm** — Which checks to enable, any command adjustments. Then proceed to step 6.

5. **Add custom** — Ask the user:
   - Is it a **check** (shell command) or a **review** (AI code review)?
   - For checks: what command to run, which entry point(s) to attach it to, any special settings (timeout, parallel, etc.)
   - For reviews: use built-in code-quality, or write a custom review prompt?

6. **Determine source directory** — Ask the user what their source directory is (e.g., `src/`, `.`, `lib/`), or infer from project structure. Skip if entry_points already has the right path (e.g., "add checks" to existing entry point).

7. **Create check/review files** — For each confirmed item:
   - Checks: write `.gauntlet/checks/<name>.yml` with the check schema fields:
     ```yaml
     command: npm run build
     parallel: true
     run_in_ci: true
     run_locally: true
     ```
   - Custom reviews: write `.gauntlet/reviews/<name>.md` with the review prompt.

8. **Update `entry_points`** — Edit `.gauntlet/config.yml`:
   - Fresh setup: add entry point(s) with confirmed checks and the built-in code-quality review.
   - Add checks/custom: append to existing entry point's checks/reviews lists.
   ```yaml
   entry_points:
     - path: "src"
       checks: [build, lint, typecheck, test, security-deps]
       reviews:
         - code-quality
   ```

9. **"Add something else?"** — After writing files, ask the user if they want to add anything else. If yes, loop back to step 5 (add custom). If no, continue.

10. **Validate** — Run `agent-gauntlet validate` to verify the configuration is valid.

11. **Suggest next steps** — Tell the user they can now run `/gauntlet-run`.

#### references/check-catalog.md

A reference file that defines the check categories and the check YAML schema. This is loaded by the agent when the skill is activated.

Content:

- **Check categories** — The 6 categories (build, lint, typecheck, test, security-deps, security-code) with descriptions of what each covers and what signals to look for.
- **Check YAML schema** — The fields available in a check file:
  - `command` (required) — Shell command to run
  - `rerun_command` (optional) — Alternative command for verification reruns
  - `working_directory` (optional) — Working directory override
  - `parallel` (default: false) — Run in parallel with other checks
  - `run_in_ci` (default: true) — Run in CI environments
  - `run_locally` (default: true) — Run locally
  - `timeout` (optional) — Timeout in seconds
  - `fix_instructions_file` (optional) — Path to fix instructions
  - `fix_with_skill` (optional) — Skill name for auto-fixing
- **Example check files** — One example per category showing a typical configuration.
- **Review YAML schema** — The fields for a review file, plus how to reference the built-in reviewer (`builtin: code-quality`).
- **Config entry_points schema** — How to structure entry points with `path`, `checks`, `reviews`, and `exclude`.

### What the gauntlet-help skill does NOT need to change

The gauntlet-help skill is for diagnosing runtime behavior. The setup skill is for initial configuration. They're independent. However, the setup skill's instructions reference `agent-gauntlet validate` for verification, which gauntlet-help's config troubleshooting also covers.

## Files Changed

### Modified
- **`src/commands/init.ts`** — Major simplification:
  - Remove `promptForConfig()`, `generateConfigYml()`, `InitConfig` interface
  - Remove lint/test command prompts
  - Remove `promptAndInstallStopHook()`, `isInteractive()` — replaced by auto-install
  - Keep: CLI detection, CLI selection prompt, `installStopHook()` export
  - Add: simplified config generation (no entry_points), auto stop hook install, next-step message
  - Keep: all skill/command installation logic (unchanged)
  - Estimated: ~400 lines removed, ~50 added

### New
- **`.claude/skills/gauntlet-setup/SKILL.md`** — Agent skill instructions for smart project scanning and check configuration
- **`.claude/skills/gauntlet-setup/references/check-catalog.md`** — Check categories, YAML schema reference, and examples

### Updated (init-generated content)
- The config template written by `init` changes to output `entry_points: []` instead of populated entry points
- The `reviews/code-quality.yml` generated by `init` changes `num_reviews` from `2` to `1`

## Pre-factoring

`src/commands/init.ts` has a Code Health score of 5.06 (Yellow). Identified code smells:
- **Large File** (1238 lines) — risk of evolving into a Brain Class
- **Complex Methods** — `promptForConfig` (cc=12), `registerInitCommand` (cc=12), `installStopHook` (cc=9)
- **Large Methods** — `buildHelpSkillBundle` (621 lines), `registerInitCommand` (115 lines), `promptForConfig` (75 lines)

This change removes `promptForConfig`, `generateConfigYml`, `promptAndInstallStopHook`, `isInteractive`, `parseSelections`, `buildAdapterSettings`, and simplifies `registerInitCommand`. This effectively serves as the refactoring — the problematic functions are deleted rather than refactored. The remaining `buildHelpSkillBundle` (621 lines) is out of scope.

**Known new smell**: `installCursorStopHook` mirrors `installStopHook`, introducing a Code Duplication warning. The two functions handle structurally different JSON formats (Claude: nested `hooks.Stop[].hooks[].command` with `type`/`timeout`; Cursor: flat `hooks.stop[].command` with `loop_limit` and top-level `version`), so a shared abstraction would add more complexity than it removes. Accepted as tech debt.

## Testing

- Update `test/commands/init.test.ts`:
  - Remove tests for lint/test command prompting
  - Remove tests for entry_points generation in config
  - Add test: config.yml is created with `entry_points: []`
  - Add test: `reviews/code-quality.yml` is created
  - Add test: next-step message is printed
  - Add test: stop hook auto-installed when Claude/Cursor detected
  - Keep: CLI detection tests, skill installation tests, `installStopHook()` unit tests

- Manual testing of the setup skill:
  - Run on a JS/TS project, a Python project, and a Go project
  - Verify it discovers the right tools and generates valid check YAMLs
  - Verify `agent-gauntlet validate` passes after setup
