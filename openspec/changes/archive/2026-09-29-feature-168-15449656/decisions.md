# Decisions — feature-168-15449656

## propose

### D1: Verdict — go with caveats
- **Decision:** Proceed. The issue is precise, bounded, reuses `cliConfigSchema`, and follows the existing `debug_log` project-over-global precedent.
- **Alternatives considered:** No-go in favor of reviewer env overrides (rejected by the issue: wrong precedence direction, Runner-owned, unreliable env inheritance in hooks); per-repo scripting to rewrite configs (doesn't remove the per-repo commit churn).
- **Decision-bearing:** yes

### D2: Resolve the effective `cli` into `project.cli` inside `loadConfig`
- **Decision:** A single resolver picks the project block (if the `cli` key is present) or the global block, and the result is written back to `project.cli` before default-preference inference, reviewer overlay, and `mergeCliPreferences`. Downstream consumers stay unchanged.
- **Alternatives considered:** Keep `project.cli` raw and add a separate `effectiveCli` field (would require touching runner, trust ledger, health, and reviewer-override); resolve lazily at each consumer (duplicated logic).
- **Decision-bearing:** no (follows the issue's Technical Approach)

### D3: The trust-ledger hash uses the effective `cli` block
- **Decision:** Because `project.cli` holds the resolved block, the `gateAffectingConfig` hash reflects the global `cli` for inheriting projects, so a global `cli` change changes the hash. This matches today's behavior for project `cli` edits.
- **Alternatives considered:** Hash only the on-disk project `cli` (would let a reviewer change pass silently under an old trust scope).
- **Decision-bearing:** no

### D4: A project `cli` key's presence decides replacement
- **Decision:** If the project config has a `cli` key, even an empty or incomplete one, it replaces the global block entirely and is validated on its own. No merging.
- **Alternatives considered:** Treat an empty project `cli: {}` as absent (implicit merge-like semantics the issue rules out).
- **Decision-bearing:** no

### D5: Any global config read/parse/schema failure other than ENOENT is a hard error for all callers
- **Decision:** `loadGlobalConfig` throws with the path and reason. This affects `run`, gate commands, `skip`, and `clean`, as the issue explicitly accepts.
- **Alternatives considered:** Hard error only when the global `cli` block is needed (inconsistent, and the issue specifies a hard error).
- **Decision-bearing:** no (specified by the issue)

### D6: Validation attributes CLI issues to the source file
- **Decision:** `validateConfig` includes the global config in `filesChecked` when it exists, reports CLI issues against whichever file supplied the effective block, and checks review `cli_preference` against the effective `default_preference`. A missing-everywhere error names both paths.
- **Alternatives considered:** Always report against the project config (misleading when the block is inherited).
- **Decision-bearing:** no

### D7: Internal test seam for the global config path, no user-facing configurability
- **Decision:** Provide an internal injection point (parameter or resolver) so tests don't read the real home directory. `design.md` picks the mechanism. A user-configurable path stays out of scope per the issue.
- **Alternatives considered:** An env var for the global path (would be a user-visible feature the issue excludes).
- **Decision-bearing:** no

## proposal-review

### PR-1 (structural): Removing project `cli` breaks `ci list-jobs` on clean CI runners — **applied**
- **Decision:** Verified that `src/commands/ci/list-jobs.ts` calls `loadConfig()` and that the generated `src/templates/workflow.yml` runs `agent-validate ci list-jobs` on a runner with no user global config. The proposal now scopes a `loadConfig` option that lets `ci list-jobs` (which only emits deterministic check jobs) load without an effective `cli` block. Malformed project or global configs still fail. The rollout needs no CI workflow change.
- **Alternatives considered:** Require CI-using repos to keep a repository `cli` block (defeats the issue's rollout for exactly the repos most likely to be shared); provision a global config in the generated workflow (adds secrets/setup to CI for a value CI never uses, and puts review settings into CI); make the missing-`cli` error lazy for all commands (broader behavior change than needed, and weakens `validate`).
- **Decision-bearing:** yes. It adds a narrow carve-out to the issue's "all `loadConfig` callers inherit the behavior automatically". It isn't direction-level: it preserves the issue's stated rollout and changes no public interface.

### PR-2 (significant): Review-level CLI/model pins defeat the "single global switch" promise — **applied**
- **Decision:** Verified that `src/commands/init-reviews.ts` generates `cli_preference: ['github-copilot']` plus per-review `model` for Copilot setups, and a per-review `model` for Codex setups. The Why now states that the global block is a default for reviews that don't pin a CLI or model. The rollout needs a one-time audit of review-level pins, documented as a migration checklist in `docs/config-reference.md`. Out of Scope now explicitly excludes a "force global" override mode, `init` changes, and automated migration.
- **Alternatives considered:** Design an opt-in override mode where the global setting beats review-level settings (contradicts the issue's stated precedence, where review-level settings rank above project and global `cli`); change `init` to stop pinning (explicitly out of scope in the issue).
- **Decision-bearing:** yes. It narrows the user-facing promise to match the issue's own precedence order, without changing scope.

### PR-3 (significant): `health` swallows config failures and exits 0 — **applied**
- **Decision:** Verified that `src/commands/health.ts` catches every `loadConfig` error except `ReviewerOverrideError`, falls back to checking all agents, and never sets a nonzero exit status for validation errors. `health` is now in scope. The all-agents fallback is reserved for "project config not found", and any other load failure or error-severity validation issue prints the error and exits nonzero. The same review showed that `validate` (`src/commands/validate.ts`) uses `loadConfig`, not `validateConfig`. The proposal now exposes the effective `cli` source on `LoadedConfig` so `validate` can report it.
- **Alternatives considered:** Fail `health` only for the new global-config/missing-`cli` cases while keeping the fallback for invalid project configs (inconsistent failure contract, and harder to specify); leave `health` unchanged (contradicts the proposal's hard-error contract).
- **Decision-bearing:** yes. `health` now exits nonzero for already-invalid project configs too. This is a small stricter-exit-code change on a diagnostic command, not a break of a persisted format or a documented interface.

## spec

### S1: Global config is always read, even when the project supplies `cli`
- **Decision:** Every command that loads project config (or reads `debug_log`) reads the global file, so a malformed global config fails even when the project has its own `cli` block. `ci list-jobs` is included: it tolerates a *missing* `cli`, not a malformed global file.
- **Alternatives considered:** Read the global file only when the project lacks `cli` (makes the issue's "hard error" contract depend on project contents, and would hide a broken file until some other repo needs it).
- **Decision-bearing:** yes

### S2: A present project `cli` key wins even when empty or incomplete
- **Decision:** `cli: {}` in the project fails with the existing "default_preference required" error. It is not filled from the global block. This follows the issue's "no merging" rule literally.
- **Alternatives considered:** Treat an empty `cli` as absent (implicit merge semantics).
- **Decision-bearing:** no

### S3: The reviewer override does not satisfy a missing `cli` block
- **Decision:** Overlay commands still fail with the missing-CLI-config error when neither file has `cli`, even if `AGENT_VALIDATOR_REVIEWER_CLI` is set. The override is an overlay on the resolved config. This is not a regression, because `cli` is required today.
- **Alternatives considered:** Let an active override stand in for a missing `cli` block (couples Runner env semantics to config resolution, and would make `validate`, which ignores the env, disagree with `run`).
- **Decision-bearing:** no

### S4: Health keeps the no-project-config fallback at exit 0
- **Decision:** When no project config exists, `health` keeps reporting "no config", checks all agents, and exits 0, unless a global config exists and is invalid. Every other configuration error makes `health` exit nonzero (per PR-3).
- **Alternatives considered:** Exit nonzero whenever the structured validator reports any error, including "Config file not found" (would break `health` as a pre-`init` diagnostic).
- **Decision-bearing:** yes. It changes the `health` exit code for projects whose config is already invalid.

### S5: Where CI job listing is specified
- **Decision:** CI job listing tolerance is specified in `global-config` ("CI job listing without CLI config") rather than a new capability, as the proposal allows. There is no existing CI spec to modify.
- **Alternatives considered:** Create a `ci-jobs` capability (more surface for one requirement).
- **Decision-bearing:** no

### S6: `validate` source reporting names the file and its kind
- **Decision:** On success, `validate` names the file that supplied the effective CLI config and whether it is the project or the global config. CLI errors name their source file. The exact wording is left to design.
- **Alternatives considered:** Report the source only on error (the issue says `validate` "reports which file it came from" without qualification).
- **Decision-bearing:** no

### S7: Existing debug_log precedence left in log-management
- **Decision:** The `log-management` spec already covers global/project `debug_log` precedence, and this change leaves that precedence as it is. `global-config` covers only file loading and error semantics (which now also govern `debug_log`-only files) and `cli`. `log-management` is not modified.
- **Alternatives considered:** Move `debug_log` precedence into `global-config` (churn with no behavior change).
- **Decision-bearing:** no

## design

### DS1: Shared `resolveEffectiveCli` module, result written back into `project.cli`
- **Decision:** A new `src/config/cli-resolution.ts` is used by both `loadConfig` and `validateConfig`. `LoadedConfig.project` is typed `LoadedProjectConfig`, which keeps `cli` required, and it gains an optional `cliSource`.
- **Alternatives considered:** A separate `effectiveCli` field read by each consumer; duplicating the resolution in the validator.
- **Decision-bearing:** no

### DS2: Non-throwing `readGlobalConfig` plus throwing `loadGlobalConfig` (`GlobalConfigError`)
- **Decision:** The structured validator consumes issue lists; runtime callers get a hard error naming the path and reason. An empty global file is treated as `{}` (defaults), not an error.
- **Alternatives considered:** A single throwing loader with try/catch in the validator (loses per-field issues); treating an empty file as invalid (would break users who created an empty file).
- **Decision-bearing:** no

### DS3: Typed errors replace message-prefix matching
- **Decision:** Add `ProjectConfigNotFoundError` (same message text) plus `isProjectConfigNotFound`, `MissingCliConfigError`, and `GlobalConfigError`. `clean` and `health` use the type checks.
- **Alternatives considered:** Keep `startsWith('Configuration file not found')` matching (fragile).
- **Decision-bearing:** no

### DS4: `requireCli: false` loader option, used only by `ci list-jobs`
- **Decision:** With the option set and no `cli` block anywhere, loading sets `project.cli = {}` and skips the reviewer overlay and `mergeCliPreferences`. All other callers stay strict, including `check`.
- **Alternatives considered:** Lazy missing-`cli` error at review dispatch; also exempting `check` (not requested, and `cli` is required for `check` today).
- **Decision-bearing:** no

### DS5: Test seam = lazily computed `getGlobalConfigPath()` + optional `globalConfigPath` parameters
- **Decision:** No env var and no `mock.module`, per `test/AGENTS.md`. Existing tests without the seam read the real global file. A HOME-isolating Bun preload is added only if interference appears.
- **Alternatives considered:** An `AGENT_VALIDATOR_GLOBAL_CONFIG` env var (user-visible configurability, out of scope); a global test preload now (broader change than needed).
- **Decision-bearing:** no

### DS6: Callers keep separate `loadGlobalConfig()` calls for `debug_log`
- **Decision:** The global config is not threaded through `LoadedConfig`. `loadConfig` surfaces global errors first, before any lock or state write.
- **Alternatives considered:** Add `global` to `LoadedConfig` (touches four callers and many fixtures for no behavioral gain).
- **Decision-bearing:** no

### DS7: `health` exit-status rule
- **Decision:** `process.exitCode = 1` when `loadConfig` fails with anything other than `ProjectConfigNotFoundError`, or when validation has error issues and either the project config was found or an error is attributed to the global file. `ValidationResult` gains `projectConfigFound`.
- **Alternatives considered:** `process.exit(1)` (may truncate output); exit on any validation error (breaks pre-`init` health; see S4).
- **Decision-bearing:** no

### DS8: The resolver returns a copy of the chosen `cli` block
- **Decision:** Default-preference inference and the reviewer overlay mutate `project.cli` in memory. Cloning prevents them from mutating the parsed global object.
- **Alternatives considered:** Deep-freeze or immutable handling throughout (larger refactor).
- **Decision-bearing:** no

## test-plan

### T1: Four integration and three E2E obligations; the rest stays at the unit level
- **Decision:**
  - INT tests cover parity between `loadConfig` and `validateConfig`, trust-hash wiring, the reviewer overlay on the resolved block, and the `health` exit matrix.
  - E2E tests go through the built binary: the adopt/override journey, the malformed-global hard error before any state, and the clean-CI/missing-everywhere journey.
- **Alternatives considered:** E2E for every scenario (duplicates cheaper layers); no E2E (would not prove the built binary reads the home-directory file or that the model reaches adapter argv).
- **Decision-bearing:** no

### T2: Home isolation is mandatory, and each HOME-based suite must prove the redirect works
- **Decision:** Tests use the `globalConfigPath` seam or a temp `HOME`, never the real file. Each HOME-based suite includes a case where the fixture changes the outcome.
- **Alternatives considered:** Rely on the seam alone (spawned binaries can't take it); a global test preload (deferred per DS5).
- **Decision-bearing:** no

### T3: Acceptance uses stub CLIs only; real review CLIs and the real user's global config are off limits
- **Decision:** No live model calls or cost. The acceptance pass uses scratch `HOME` directories and `node dist/index.js`.
- **Alternatives considered:** Allow one live review call (paid and non-deterministic, and adds nothing beyond argv capture).
- **Decision-bearing:** no

### T4: No human-only testing
- **Decision:** Every obligation is observable through exit codes, output, argv captures, and files.
- **Alternatives considered:** None.
- **Decision-bearing:** no

## approach-review

### AR-1 (high): Specified review-model-over-adapter-model precedence contradicts `invokeAdapter` — **applied (spec revised to match existing behavior)**
- **Decision:** Verified `src/gates/review-runtime-helpers.ts:26` (`adapterCfg?.model ?? config.model`) and the existing test "adapter model takes priority over review-level model". Model precedence stays adapter-first and unchanged: reviewer override model (via the overlaid adapter block) > effective adapter `model` (project or global) > review `model` > built-in.
  - The `global-config` "CLI settings precedence" requirement is now per field. For CLI choice, the review `cli_preference` beats `default_preference`; for model, the adapter model wins. It adds scenarios for the inherited adapter model beating the review model, the review model as fallback, and the override model beating both.
  - The `reviewer-override` precedence sentence now points to it.
  - The proposal's Why, precedence, Out of Scope and Impact are revised: review `model` pins no longer need migrating; `cli_preference` pins still do.
  - The design and test plan (E2E-001) now cover model precedence end to end.
- **Alternatives considered:** Make model resolution source-aware so the review model beats the effective adapter model. That would change which model existing projects that keep their `cli` block run with, contradicting the issue's "fully backward compatible" Impact and its "downstream needs no changes" Technical Approach. It would also need a new route for override models.
- **Decision-bearing:** yes. It interprets the issue's single precedence line per field. It isn't direction-level: the issue's explicit backward-compatibility commitment resolves the ambiguity, and the result makes the global model switch the user wants more effective.

### AR-2 (high): The loader does not enforce the CLI rules that `validate`/`health` and INT-001 parity assume — **applied**
- **Decision:** Verified that `loader.ts` only infers and checks review preferences, while `validator.ts:445-493` holds the non-empty and valid-tool checks.
  - Added the shared `inferDefaultPreference` + `validateCliSemantics` to `cli-resolution.ts`. `loadConfig` throws `InvalidCliConfigError` (naming the source file and field) before any gate or lock and before the reviewer overlay, whether or not the project has reviews. `validateConfig` maps the same issues. `ci list-jobs` (`requireCli: false`) skips them.
  - New spec requirement: "Effective CLI config is semantically validated at load".
  - INT-001 gains check-only rows 8–9, INT-004 gains states 7–8, and the design test strategy is updated.
- **Alternatives considered:** Keep the loader lenient and drop the parity claim. Then `validate` (which uses `loadConfig`) would accept `cli: {}` and `[not-a-tool]`, contradicting the specs.
- **Decision-bearing:** yes. Runtime loading now rejects already-invalid `cli` blocks, which `health` already flagged, for projects that keep their `cli` block. This is recorded in the proposal's Impact and the design's Risks/Migration.

### AR-3 (medium): `clean` with no project config and no logs returns success before reading the global file — **applied**
- **Decision:** Verified `src/commands/clean.ts:23-38`. In the missing-project branch, `clean` now calls `loadGlobalConfig()` before the log-directory check and its early success return, and reuses that snapshot for `debug_log`.
  - Added a spec sentence and the scenario "Clean in an uninitialized directory fails on malformed global config".
  - Added the design change and an E2E-002 journey step.
- **Alternatives considered:** Exempt `clean` in uninitialized directories (contradicts "every command that reads global settings").
- **Decision-bearing:** no

### AR-4 (medium): The second `loadGlobalConfig` read in `run` happens after the lock and can mix file versions — **applied (supersedes DS6)**
- **Decision:** Verified `run-executor.ts`: `initRunContext` calls `loadGlobalConfig` after the lock and startup reconciliation.
  - `LoadedConfig` gains a required `globalConfig` snapshot, read once in `loadConfig` before any lock. `run-executor`, `gate-command` and `skip` use `config.globalConfig.debug_log`; `clean` reads once in either branch.
  - Spec: "at most once per invocation", plus the scenario "One global config snapshot per invocation".
  - Tests: a source-scan unit test restricting `loadGlobalConfig` callers, and a loader test that the snapshot is unaffected by a later file change.
  - The five test files that hand-build `LoadedConfig` add `globalConfig: DEFAULT_GLOBAL_CONFIG`.
- **Alternatives considered:** Keep two reads and narrow the before-lock guarantee (accepts mid-run failures after startup effects, and mixed-version settings).
- **Decision-bearing:** no

### AR-5 (medium): The design allowed existing tests to read the real global config, contradicting the test plan — **applied (revises DS5)**
- **Decision:** Isolation is now a prerequisite. A Bun test preload (`test/setup/isolate-global-config.ts` via `bunfig.toml`) calls a test-only `setGlobalConfigPathForTests` override, pointing to a non-existent file in a fresh temp dir, before any test module loads.
  - `HOME` is left untouched, because git identity and other tools in the tests depend on it.
  - A sentinel test asserts that the preloaded path is under the OS temp dir.
  - Spawned E2E children set `HOME`, and each spawned suite proves a fixture changes the outcome.
  - The design's conditional acceptance of real-home reads is removed.
- **Alternatives considered:** A test-wide scratch `HOME` (breaks HOME-dependent tooling such as git identity); a path env var (user-visible configurability, which is out of scope); routing all 62 existing `loadConfig` call sites through the parameter (large churn for the same effect).
- **Decision-bearing:** no

## tasks

### TK1: One implementation task covering the whole change
- **Decision:** `tasks.md` lists a single task, `tasks/global-cli-config.md`. Test isolation comes first inside it as a prerequisite step, not as a separate task. It follows the task-file format of the archived feature-165 change.
- **Alternatives considered:** Splitting isolation, loader, commands, and docs into separate tasks (the instruction requires exactly one task).
- **Decision-bearing:** no
