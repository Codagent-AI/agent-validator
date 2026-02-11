## 0. Pre-factoring

`src/commands/init.ts` is a hotspot (Code Health: 5.06 — Large File, Complex Methods, Large Methods). However, this change will **remove** the problematic functions (`promptForConfig`, `generateConfigYml`, `promptAndInstallStopHook`, `isInteractive`, much of `registerInitCommand`'s complexity), which should improve health. The remaining `buildHelpSkillBundle` (621 lines) is out of scope for this change.

No pre-factoring needed — the change itself is the refactoring.

## 1. Implementation

- [ ] 1.1 Add Cursor stop hook installation function to `src/commands/init.ts` — Create `installCursorStopHook(projectRoot)` that writes `.cursor/hooks.json` with the Cursor hooks format (`version: 1`, `hooks.stop` array with `command: "agent-gauntlet stop-hook"`, `loop_limit: 10`). Handle: directory creation, existing file merge, duplicate detection. Mirror the existing `installStopHook()` pattern.

- [ ] 1.2a Remove obsolete functions from `src/commands/init.ts` — Delete `promptForConfig()`, `generateConfigYml()`, `InitConfig` interface, `parseSelections()`, `buildAdapterSettings()`, `promptAndInstallStopHook()`, `isInteractive()`.

- [ ] 1.2b Rewrite `registerInitCommand` in `src/commands/init.ts` — Keep CLI detection and CLI selection prompt. Replace config generation with a simpler template that outputs `entry_points: []` with base branch auto-detected from git remote (falling back to `origin/main` if detection fails). If `config.yml` already exists, preserve it entirely. After skill installation, auto-call `installStopHook()` for Claude and `installCursorStopHook()` for Cursor (based on selected CLIs). Add next-step message.

- [ ] 1.3 Update `--yes` flag behavior — When `--yes` is passed: use all available CLIs (no prompt), auto-install stop hooks for Claude/Cursor, write config with empty entry_points.

- [ ] 1.4 Write SKILL.md content for gauntlet-setup — Author the full skill instructions covering the 11-step workflow from design.md: check for config.yml existence (abort with guidance if missing), check existing config (fresh/add/reconfigure paths), scan project, present findings table, confirm with user, add custom flow, determine source directory, create check/review files, update entry_points, "add something else?" loop, validate (including validation failure recovery: display errors, apply one corrective attempt, rerun validate once, stop and ask user if still failing), suggest next steps.

- [ ] 1.5 Write check-catalog.md reference — Author the reference file with: 6 check category definitions (build, lint, typecheck, test, security-deps, security-code) with signals to look for, the check YAML schema (all fields), at least one example check file per category, the review YAML schema including built-in reviewer reference, and the config entry_points schema.

- [ ] 1.6 Wire setup skill into SKILL_DEFINITIONS in `src/commands/init.ts` — Add a new entry for `gauntlet-setup` with content and references, following the existing `buildHelpSkillBundle()` pattern. Ensure existing skill files are not overwritten if already present (idempotent install).

- [ ] 1.7 Update `reviews/code-quality.yml` generation — Change `num_reviews` from `2` to `1` in the generated review config.

## 2. Tests

- [ ] 2.1 Test: `init` creates config.yml with empty entry_points
- [ ] 2.2 Test: `init` creates reviews/code-quality.yml with `num_reviews: 1`
- [ ] 2.3 Test: `init --yes` uses all available CLIs, writes config, and auto-installs stop hooks
- [ ] 2.4 Test: `init` auto-installs Claude stop hook when Claude is selected
- [ ] 2.5 Test: `init` auto-installs Cursor stop hook when Cursor is selected
- [ ] 2.6 Test: Cursor stop hook creates `.cursor/hooks.json` with correct format
- [ ] 2.7 Test: Cursor stop hook merges with existing hooks.json
- [ ] 2.8 Test: Cursor stop hook skips if already installed
- [ ] 2.9 Test: `init` prints next-step message
- [ ] 2.10 Test: `init` does not prompt for base branch, lint, or test commands
- [ ] 2.11 Test: `init` installs gauntlet-setup skill with SKILL.md and references/check-catalog.md
- [ ] 2.12 Remove obsolete tests: lint/test command prompting, entry_points generation, stop hook prompt
- [ ] 2.13 Test: `init` does not overwrite existing gauntlet-setup skill files
- [ ] 2.14 Test: `init` on existing project preserves config.yml and review config entirely
- [ ] 2.15 Test: `init` auto-detects base branch from git remote and falls back to origin/main

Note: The `/gauntlet-setup` skill behavior (existing config options, add-check filtering, reconfigure backup, custom-add loop, check catalog loading) is agent-driven — these are SKILL.md instructions, not programmatic code. They are verified through manual testing, not unit tests.

## 3. Documentation

- [ ] 3.1 Update `docs/user-guide.md` — Document the new init workflow (CLI selection only, no config prompts), auto stop hook installation, and the `/gauntlet-setup` skill for configuring checks and reviews.
- [ ] 3.2 Update `docs/config-reference.md` — Note that `entry_points` starts empty after `init` and is populated by the `/gauntlet-setup` skill.
- [ ] 3.3 Update `docs/quick-start.md` — Update the init steps to reflect the simplified flow and add the `/gauntlet-setup` step.
- [ ] 3.4 Update `docs/skills-guide.md` — Add `/gauntlet-setup` to the list of available skills.

## 4. Manual Verification

- [ ] 4.1 Verify no interactive prompts remain for base branch, lint command, or test command: `grep -n "promptForConfig\|lintCmd\|testCmd\|baseBranchInput\|sourceDirInput" src/commands/init.ts` — expect zero matches.
- [ ] 4.2 Verify no stop hook prompt remains: `grep -n "promptAndInstallStopHook\|Install Claude Code stop hook" src/commands/init.ts` — expect zero matches.
- [ ] 4.3 Verify `/gauntlet-setup` missing config guard: Run `/gauntlet-setup` in a project without `.gauntlet/config.yml`. Confirm the agent informs the user to run `agent-gauntlet init` first and does not proceed with scanning or writing files.
- [ ] 4.4 Verify `/gauntlet-setup` fresh setup flow: Run `/gauntlet-setup` in a project with `entry_points: []`. Confirm the agent scans the project, presents a table of discovered checks, and asks for confirmation. Expected artifacts: `.gauntlet/checks/<name>.yml` files for confirmed checks, updated `entry_points` in config.yml including `code-quality` review.
- [ ] 4.5 Verify `/gauntlet-setup` existing config flow: Run `/gauntlet-setup` in a project with populated `entry_points`. Confirm the agent shows current config summary and offers three options (add checks, add custom, reconfigure). Expected: existing entry_points displayed correctly, options presented.
- [ ] 4.6 Verify `/gauntlet-setup` reconfigure flow: Select "reconfigure" on a project with existing checks and custom reviews. Confirm existing `.gauntlet/checks/*.yml` files and custom `.gauntlet/reviews/*.md` files are renamed with `.bak` suffix before replacement. Expected: `<name>.yml.bak` and `<name>.md.bak` files alongside new files.
- [ ] 4.7 Verify `/gauntlet-setup` add-check filtering: Run "add checks" on a project that already has some checks configured. Confirm already-configured checks are excluded from scan results. Expected: only unconfigured tools appear in the results table.
- [ ] 4.8 Verify `/gauntlet-setup` validation recovery: Intentionally create an invalid check file, then run setup. Confirm the agent detects the `validate` failure, applies one corrective attempt, reruns validate, and either succeeds or stops and asks for guidance. Expected: at most two validate runs before resolution or user prompt.
- [ ] 4.9 Verify `/gauntlet-setup` no-tools-discovered flow: Run `/gauntlet-setup` in a minimal project with no recognizable tooling signals (no package.json, Makefile, etc.). Confirm the agent reports no tools detected and offers the custom addition flow. Expected: no check table shown, agent transitions to custom check/review prompts.
- [ ] 4.10 Verify custom check/review addition flow: Run `/gauntlet-setup`, choose "add custom", add a custom check and a custom review. Expected: `.gauntlet/checks/<name>.yml` created for the check, `.gauntlet/reviews/<name>.md` (or `.yml` for built-in) created for the review, both referenced in `entry_points`.
- [ ] 4.11 Verify "add something else" loop: After adding a custom item, confirm the agent asks if user wants to add more. Select yes, add another item, then select no. Expected: agent proceeds to validation after the user declines to add more.
- [ ] 4.12 Verify "decline all discovered checks" flow: Run `/gauntlet-setup` fresh, decline all discovered checks. Confirm the agent offers the custom addition flow and that `code-quality` review is still included in `entry_points` regardless.

## 5. Validation

If there is a "Manual Verification" section above, complete all verification steps before marking the task complete.

- [ ] 5.1 Run the full test suite: `bun test` — all tests must pass.
- [ ] 5.2 Run the linter: `bun run lint` — no errors.
- [ ] 5.3 Run `openspec validate` — change must pass validation.
