## Why

Orchestrators like agent-runner need `agent-validator init` to scaffold opt-in built-in reviews (currently `task-compliance` and `test-integrity`) into `.validator/config.yml` so a runtime `--enable-review <name>` flag has a config entry to flip on. Today nothing in `init` writes those entries; per `docs/user-guide.md`, `--enable-review` only activates a review that is already defined, so the orchestrator's runtime flag is silently ignored. The companion fix on the agent-runner side is paused on this change.

Context and the agent-runner-side counterpart are tracked in `/Users/paul/codagent/agent-runner/worktrees/task-compliance/openspec/changes/task-compliance/handoff-agent-validator.md`.

## What Changes

- New `--enable-builtin <name>` option on `agent-validator init`, repeatable, value drawn from the existing `optInBuiltIns` set in `src/built-in-reviews/index.ts` (today: `task-compliance`, `test-integrity`).
- Unknown or non-opt-in names → init fails with a clear error before scaffolding anything.
- When `--enable-builtin` is passed on a fresh init, the generated `config.yml` SHALL include one inline review entry per requested name under the root entry point's `reviews:`, each with `builtin: <name>`, `enabled: false`, and the explanatory comment from the handoff. These entries are written **in addition to** any reviews chosen by the existing recommendation logic, and they are written **even when** the user opts out of local AI reviews.
- When `.validator/` already exists, init does not patch the existing config (per the "accept the gap" decision). If `--enable-builtin` is passed in that situation, init SHALL print a warning naming the requested built-ins and pointing the user at the exact YAML to paste into `config.yml` so the flag isn't silently dropped.
- The `ReviewEntry` type gains an optional `enabled` field so the writer can emit `enabled: false`. Existing recommended entries continue to omit the field (the default at runtime is `true`).

## Capabilities

### Modified Capabilities
- `init-config`: new `--enable-builtin` flag; opt-in entries scaffolded with `enabled: false`; warning when `.validator/` already exists; behavior reconciled with the existing "local AI reviews opted out" scenario.

## Out of Scope

- The agent-runner side (wiring `--enable-builtin task-compliance` into `validatorInitArgs` and `--enable-review task-compliance --context-file {{task_file}}` into `workflows/core/run-validator.yaml`). Tracked in the agent-runner repo.
- A companion `agent-validator config add-review` command for migrating existing projects. Explicitly rejected this round in favor of the documented "accept the gap" path; revisit if real-world friction warrants it.
- Patching existing `.validator/config.yml` files from `init`. Out of scope; YAML-rewrite risk is not justified for the volume of existing installs.
- Any change to runtime activation semantics for `--enable-review` or `--context-file`. Those already work per `dynamic-review-control`; this change only ensures the config entry exists.
- Adding `task-compliance` (or any opt-in built-in) as a default review in `init` or `validator-setup`. The review is meaningful only when an orchestrator supplies a task file.

## Impact

- **Code:**
  - `src/commands/init.ts` — register the new option; validate names; thread the list through `runInit` → `selectReviewsAndConfirmInstall` → `scaffoldValidatorDir` → `writeConfigYml`; emit the "skipped, paste this" warning in the existing-`.validator/` branch.
  - `src/commands/init-reviews.ts` — extend `ReviewEntry` with optional `enabled`; add a helper that turns a list of opt-in built-in names into `ReviewEntry`s with `enabled: false`.
  - `src/commands/init-config-helpers.ts` — `writeConfigYml` emits `enabled: false` and the load-bearing comment for opt-in entries; opt-in entries are written even when the recommended `reviewConfig.reviews` is empty (opt-out path).
- **Docs:** `docs/user-guide.md` and `docs/config-reference.md` get a short section on the new flag and the "accept the gap" migration story for existing projects.
- **Tests:** fresh init with flag writes the entry with `enabled: false`; fresh init without flag does not write any opt-in entries; fresh init with flag + local AI reviews opted out writes only the opt-in entry; existing-`.validator/` re-run with flag prints the warning and does not modify the config; unknown name passed to flag errors before scaffolding.
- **No new package dependencies. No changes to runtime gate execution.**
- **Versioning:** agent-runner will require a minimum agent-validator version exposing this flag. Out-of-scope to coordinate the bump here — handled at release time.
