## 0. Pre-factoring

`src/commands/init.ts` — Code Health: 7.87 (below threshold 8.5)

Code smells identified:
- **Complex Method**: `installStopHook` (cc=9), `installCommands` (cc=9)
- **Code Duplication**: `installStopHook` and `installCursorStopHook` share nearly identical merge/dedup logic
- **Primitive Obsession / String Heavy Arguments**: 40% of functions use primitive string args

Targeted refactoring (scoped to what this change touches):

- [ ] 0.1 Extract shared hook-merge logic from `installStopHook`/`installCursorStopHook` into a reusable `mergeHookConfig(filePath, hookKey, hookEntry, deduplicateCmd)` helper to reduce duplication — the new `installStartHook`/`installCursorStartHook` functions will reuse this helper instead of duplicating the pattern a third and fourth time

## 1. Implementation

- [ ] 1.1 Update `buildGauntletSkillContent()` in `src/commands/init.ts`: change `disable-model-invocation` from `true` to `false` and update the `description` field to the actionable text from design.md
- [ ] 1.2 Update `.claude/skills/gauntlet-run/SKILL.md` frontmatter to match the new template (description + `disable-model-invocation: false`)
- [ ] 1.3 Create `src/commands/start-hook.ts` with `registerStartHookCommand()`:
  - Check for `.gauntlet/config.yml` presence (fast exit if absent)
  - Parse/validate config YAML: treat empty or malformed YAML as non-gauntlet (silent no-op exit 0)
  - Accept `--adapter` flag (`claude` or `cursor`, default `claude`)
  - Output context injection in the appropriate format (JSON for Claude, plain text for Cursor)
  - Exit 0
- [ ] 1.4 Add start hook config constants to `src/commands/init.ts`:
  - `CLAUDE_START_HOOK_CONFIG` (SessionStart hook with matcher for startup|resume|clear|compact)
  - `CURSOR_START_HOOK_CONFIG` (beforeSubmitPrompt hook with command `agent-gauntlet start-hook --adapter cursor`)
- [ ] 1.5 Implement `installStartHook(projectRoot)` using the `mergeHookConfig` helper from pre-factoring step 0.1, including console confirmation message
- [ ] 1.6 Implement `installCursorStartHook(projectRoot)` using the `mergeHookConfig` helper, including console confirmation message
- [ ] 1.7 Call `installStartHook()` and `installCursorStartHook()` from `registerInitCommand()` alongside existing stop hook installation
- [ ] 1.8 Export `registerStartHookCommand` from `src/commands/index.ts`
- [ ] 1.9 Register the `start-hook` command in `src/index.ts`
- [ ] 1.10 Update `docs/user-guide.md` to cover the new `start-hook` command and the modified `init` behavior (start hook installation alongside stop hook)

## 2. Tests

- [ ] 2.1 Test: start-hook exits silently when no `.gauntlet/config.yml` exists
- [ ] 2.2 Test: start-hook with `--adapter claude` outputs valid Claude Code SessionStart JSON when gauntlet config present
- [ ] 2.3 Test: start-hook with `--adapter cursor` outputs plain text context message when gauntlet config present
- [ ] 2.4 Test: start-hook without `--adapter` flag defaults to Claude Code JSON format
- [ ] 2.4b Test: start-hook with unrecognized `--adapter` value (e.g., `--adapter vscode`) defaults to Claude Code JSON format
- [ ] 2.5 Test: context message includes invocation conditions (run after coding tasks)
- [ ] 2.6 Test: context message includes exclusion conditions (skip for read-only tasks)
- [ ] 2.6b Test: context message includes uncertainty guidance (when unsure, run it — false positives less costly than false negatives)
- [ ] 2.7 Test: `installStartHook` creates `SessionStart` hook in new settings file
- [ ] 2.8 Test: `installStartHook` merges into existing settings without overwriting
- [ ] 2.9 Test: `installStartHook` deduplicates on repeated runs
- [ ] 2.10 Test: `installCursorStartHook` creates `beforeSubmitPrompt` hook in new hooks file
- [ ] 2.11 Test: `installCursorStartHook` deduplicates on repeated runs
- [ ] 2.11b Test: `installCursorStartHook` merges into existing hooks file without overwriting
- [ ] 2.12 Test: `buildGauntletSkillContent('run')` generates frontmatter with `disable-model-invocation: false` and actionable description
- [ ] 2.13 Test: `mergeHookConfig` helper correctly handles create, merge, and dedup cases
- [ ] 2.14 Test: `installStartHook` and `installCursorStartHook` output confirmation messages
- [ ] 2.15 Test: start-hook exits 0 when `.gauntlet/config.yml` exists but is malformed/empty (error resilience)
- [ ] 2.16 Test: start-hook does not read from stdin (pipe empty stdin, verify same output)
- [ ] 2.17 Test: context message is wrapped in `<IMPORTANT>` tags

## 3. Manual Verification

- [ ] 3.1 Manual: run `agent-gauntlet init` in a test project and verify `.claude/settings.local.json` contains both `Stop` and `SessionStart` hooks
- [ ] 3.2 Manual: run `agent-gauntlet start-hook` in a gauntlet project and verify valid JSON output
- [ ] 3.3 Manual: run `agent-gauntlet start-hook` outside a gauntlet project and verify silent exit (no output, exit 0)

## 4. Validation

If there is a "Manual Verification" section above, complete all verification steps before marking the task complete.

All Section 2 automated tests must pass before marking the task complete. The gauntlet stop hook will additionally run the full verification suite (lint, typecheck, build, test, reviews) on completion.
