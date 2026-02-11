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

## 4. Validation

The gauntlet suite will run all automated checks (tests, linting, openspec validation).
