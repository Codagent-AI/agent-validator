# Task: Global CLI/model defaults in the user-level config

## Goal

Let users set their default review CLI and adapter settings (`cli.default_preference`, `cli.adapters`)
once in `~/.config/agent-validator/config.yml`. Projects without a `cli` block inherit that global
block unchanged. A project `cli` block replaces it entirely, with no field-level merging. Along the
way:

- a malformed global config becomes a hard error;
- CI job discovery works with no `cli` block anywhere;
- `validate` reports which file supplied the CLI config;
- `health` exits nonzero on configuration errors.

This implements GitHub issue #168.

## Background

Read these first, in `openspec/changes/feature-168-15449656/`:

- `proposal.md`;
- `specs/global-config/spec.md`, `specs/review-config/spec.md`, and `specs/reviewer-override/spec.md`;
- `design.md`, which is the implementation blueprint: module APIs, the loader flow, and the command
  changes;
- `test-plan.md`.

`decisions.md` records why each choice was made. The approach-review entries AR-1…AR-5 supersede the
earlier DS5 and DS6.

### Current code

- `src/config/global.ts`:
  - `GLOBAL_CONFIG_PATH` is computed once at module load from `os.homedir()`.
  - `globalConfigSchema` has only `debug_log`.
  - `loadGlobalConfig()` returns defaults on `ENOENT`, and **warns and returns defaults** when the
    file is invalid.
- `src/config/schema.ts`: `validatorConfigSchema.cli` is required (`cliConfigSchema`).
  `cliConfigSchema` is `{ default_preference?: string[] (min 1), adapters?: Record<string, adapterConfigSchema> }`.
  `schema.ts` imports only `zod`.
- `src/config/loader.ts`, `loadConfig(rootDir, { applyReviewerOverride })`:
  - throws `Error('Configuration file not found at …')` when the project config is missing;
  - parses the project config;
  - infers `default_preference` from adapter keys;
  - extracts inline gates, then loads checks and reviews;
  - optionally overlays the reviewer override;
  - runs `mergeCliPreferences`, which fills each review's `cli_preference` and throws when a review
    tool is outside `default_preference`;
  - validates entry-point references.

  It never rejects an empty `default_preference` or unknown tool names.
- `src/config/validator.ts`: `validateConfig(rootDir)` returns `{ valid, issues, filesChecked }`.
  `validateCliConfig` (around lines 445–530) holds the non-empty-preference and valid-tool checks,
  attributing them to the project config path, and returns early when `cli` is absent. It is used
  only by `health`.
- `src/config/types.ts`: `LoadedConfig = { project: NormalizedValidatorConfig; checks; reviews; reviewerOverride? }`.
- Downstream readers of `config.project.cli`, which must keep working unchanged:
  - `src/core/runner.ts` (`project.cli?.adapters` → review executor);
  - `src/utils/trust-ledger.ts` (`gateAffectingConfig` hashes `project.cli`);
  - `src/config/reviewer-override.ts` (`applyReviewerOverrideToConfig` mutates `project.cli`);
  - `src/gates/review-runtime-helpers.ts`, where `invokeAdapter` uses `adapterCfg?.model ?? config.model`.
    That is the adapter-first model precedence, and it stays as it is.
- Global config consumers that each call `loadGlobalConfig()` separately for `debug_log`:
  - `src/core/run-executor.ts` (`initRunContext`, called **after** the lock and startup
    reconciliation);
  - `src/commands/gate-command.ts`;
  - `src/commands/skip.ts`;
  - `src/commands/clean.ts`.
- Commands:
  - `src/commands/validate.ts` only calls `loadConfig()`.
  - `src/commands/health.ts` prints `validateConfig` results without an exit code. It catches every
    `loadConfig` error except `ReviewerOverrideError` and falls back to `checkAllAgentsHealth()`.
  - `src/commands/clean.ts` detects a missing project config with a message prefix
    (`isMissingConfig`). When there is no project config and no log dir, it returns "Logs archived
    successfully." before reading the global config.
  - `src/commands/ci/list-jobs.ts` calls `loadConfig()`. The generated `src/templates/workflow.yml`
    runs `agent-validate ci list-jobs` on clean CI runners.
- Tests:
  - Bun runs every test file in one process; see `test/AGENTS.md` and never use `mock.module()` on
    shared modules.
  - E2E tests spawn `dist/index.js` through `spawnValidator`, and use stub CLIs from
    `test/integration/helpers.ts`. `createReviewerOverrideStubs` records argv.
  - Five test files build `LoadedConfig` by hand: `test/core/reconciliation.test.ts`,
    `test/core/job.test.ts`, `test/core/runner.test.ts`, `test/utils/trust-ledger.test.ts`, and
    `test/utils/trust-ledger-full-tree.test.ts`.

## What to implement

Follow `design.md` §Approach. In summary:

1. **Test isolation first (prerequisite).**
   - In `global.ts`, replace the constant with a lazily computed `getGlobalConfigPath()`, and add a
     test-only `setGlobalConfigPathForTests(path | undefined)`. The override takes precedence when
     set. Do not wire it to any env var or flag.
   - Add `test/setup/isolate-global-config.ts`, registered as a Bun test preload in `bunfig.toml`
     (create the file if it is missing: `[test]` `preload = ["./test/setup/isolate-global-config.ts"]`).
     It creates a temp dir and points the override at a non-existent `config.yml` inside it.
   - Leave `HOME` untouched.
   - Add a sentinel test asserting that the preloaded path is under `os.tmpdir()`.
   - Adjust `test/config/global.test.ts` to use the path parameter or the override. It may clear the
     override temporarily, with a temp `HOME`, to exercise the real `os.homedir()` path, and must
     restore it afterwards.

2. **Global config module (`src/config/global.ts`).**
   - Add `cli: cliConfigSchema.optional()` to `globalConfigSchema`, imported from `schema.ts`.
   - Add a non-throwing `readGlobalConfig(configPath = getGlobalConfigPath())` that returns
     `missing | ok | invalid`, with per-issue `{ message, field? }`.
     - `ENOENT` → `missing`.
     - An empty file → `ok`, with defaults.
     - A read error, a YAML error, or a `ZodError` → `invalid`.
   - `loadGlobalConfig(configPath = getGlobalConfigPath())` builds on it. It throws a
     `GlobalConfigError` (with a `path` property) with the message
     `Invalid global config at <absolute path>: <field: message; …>` and prints no warning.

3. **CLI resolution module (new `src/config/cli-resolution.ts`).** It exports:
   - `CliSource` / `ResolvedCli`;
   - `resolveEffectiveCli({ projectCli, projectConfigPath, globalCli, globalConfigPath })`: the
     project block wins whenever `projectCli !== undefined` (including `{}`); otherwise the global
     block; otherwise `undefined`. It returns a shallow clone, with `adapters` copied too;
   - `MissingCliConfigError` + `missingCliConfigMessage(projectPath, globalPath)`, which names both
     paths;
   - `describeCliSource(source)`, which returns `"<path> (project config)"` or
     `"<path> (global config)"`;
   - `inferDefaultPreference(cli)`;
   - `validateCliSemantics(cli): CliIssue[]`, which checks for a non-empty `default_preference` and
     that every tool is in `getValidCLITools()`. Move this logic out of `validator.ts`;
   - `InvalidCliConfigError`, with `path` and `issues`.

4. **Loader (`src/config/loader.ts`, `src/config/schema.ts`, `src/config/types.ts`).**
   - Make `validatorConfigSchema.cli` optional.
   - Add `LoadedProjectConfig = NormalizedValidatorConfig & { cli: CLIConfig }`.
   - `LoadedConfig` gets `project: LoadedProjectConfig`, a **required** `globalConfig: GlobalConfig`,
     and an optional `cliSource?: CliSource`.
   - Add `ProjectConfigNotFoundError`, keeping the same message text, and `isProjectConfigNotFound()`.
   - Add the options `requireCli?: boolean` (default `true`) and `globalConfigPath?: string`.
   - Flow:
     1. Throw `ProjectConfigNotFoundError` if the project config is missing.
     2. Parse the project config.
     3. Call `loadGlobalConfig(globalConfigPath)`, which may throw.
     4. Resolve the CLI block. If there is none and `requireCli` is set, throw
        `MissingCliConfigError`.
     5. Set `project.cli = inferDefaultPreference(resolved.cli)`, then run `validateCliSemantics`.
        If it finds issues and `requireCli` is set, throw `InvalidCliConfigError`. This happens
        before the overlay and before any gate or lock, whether or not the project has reviews.
     6. Load gates.
     7. Apply the reviewer overlay and `mergeCliPreferences`. Skip both when `requireCli` is false
        and no valid block exists. Change the `mergeCliPreferences` message to name the source via
        `describeCliSource`.
     8. Validate entry points.
     9. Return `{ project, checks, reviews, globalConfig, cliSource, reviewerOverride? }`.
   - When `requireCli === false`, CLI semantic issues and a missing block are both ignored, and
     `project.cli` is the resolved block or `{}`.

5. **Structured validator (`src/config/validator.ts`).**
   - Change the signature to `validateConfig(rootDir, { globalConfigPath? })`, and add
     `projectConfigFound: boolean` to `ValidationResult`.
   - Call `readGlobalConfig`. Add an existing file to `filesChecked`, and push `invalid` issues with
     `file = global path`.
   - Resolve with `resolveEffectiveCli`, using a parse-valid global block only.
     - No block while the project config parsed → an error on `field: 'cli'` with
       `missingCliConfigMessage`.
     - Otherwise, map the `inferDefaultPreference` + `validateCliSemantics` issues to `file = source.path`.
   - Check review `cli_preference` against the effective preference, still attributed to the review
     file, and change the message to reference the source file.
   - Skip CLI validation when the project config is missing, as today.

6. **Commands.**
   - `validate`: after success, print `All config files are valid.` followed by
     `CLI config: <describeCliSource(config.cliSource)>`. Errors keep the `Validation failed:` path
     and exit 1.
   - `health`:
     - `validateAndDisplayConfig()` returns the result.
     - On a `ReviewerOverrideError`, behave as today.
     - On `isProjectConfigNotFound`, run `checkAllAgentsHealth()` (keep the fallback).
     - On any other load error, print `Error: <message>`, skip the fallback, and mark failure.
     - Set `process.exitCode = 1` on a load failure, or on error-severity validation issues when
       either `projectConfigFound` is true or any error issue's `file` is the global path.
     - Use `process.exitCode`, not `process.exit()`.
   - `ci list-jobs`: `loadConfig(process.cwd(), { requireCli: false })`.
   - `run-executor`, `gate-command`, and `skip`: delete their `loadGlobalConfig()` calls, and use
     `config.globalConfig.debug_log` in `mergeDebugLogConfig`.
   - `clean`:
     - replace `isMissingConfig` with `isProjectConfigNotFound`;
     - when the project config loads, use `config.globalConfig`;
     - in the missing-project branch, call `loadGlobalConfig()` **before** the log-dir existence
       check and its early success return, and reuse that result for `debug_log`.
   - Other `loadConfig` callers (`list`, `detect`, `update-review`, `health`) need no changes beyond
     the above.

7. **Test fixtures.** Add `globalConfig: DEFAULT_GLOBAL_CONFIG` to the five hand-built `LoadedConfig`
   fixtures listed above.

8. **Documentation.**
   - `docs/config-reference.md`:
     - mark `cli` optional in Top-Level Fields;
     - add a "Global Config" section covering location, the `debug_log` and `cli` blocks,
       whole-block replacement, per-field precedence (CLI choice: override > review
       `cli_preference` > effective `default_preference`; model: override > effective adapter
       `model` > review `model` > built-in), the hard error on an invalid file, and changes to the
       global `cli` block changing the trust scope of inheriting projects;
     - add a migration checklist: add the global `cli` block, remove the project `cli` block, audit
       review `cli_preference` pins (such as Copilot pins generated by `init`), note that review
       `model` pins are overridden by a global adapter `model`, then run `validate` and look for
       `(global config)`.
   - `docs/ci.md`: CI job discovery needs no `cli` block and no global config.
   - `docs/troubleshooting.md` and `skills/validator-help/references/config-troubleshooting.md`
     (the distributed skill source): the "No `cli` block found" error, the invalid global config
     error, the invalid `cli` config error at load, and `health` now exiting nonzero on config errors.
   - `docs/cli-reference.md`: only if it describes `validate`/`health` output or exit status.
   - Do not hand-edit `CHANGELOG.md` or add a `.changeset` file.

## Tests

Follow `test/AGENTS.md`: use dependency injection and no `mock.module()`. Save and restore
`process.env` and the global-path override in every test that changes them.

- **Unit tests** (see `design.md` §Test strategy):
  - `global.ts`: missing, `debug_log`-only, a `cli` block, invalid YAML, a schema-invalid field, an
    empty file, and the `GlobalConfigError` path/message.
  - `cli-resolution.ts`: project wins (including `{}`), global fallback, none, the returned copy is
    independent, the message names both paths, `validateCliSemantics`, `inferDefaultPreference`.
  - Loader:
    - inherit;
    - replacement with no adapter merge;
    - `cli: {}` does not inherit;
    - a malformed global fails even when the project has `cli`;
    - missing everywhere, including the legacy `.gauntlet` path;
    - `cli: {}` and an inherited `[not-a-tool]` fail even with no reviews;
    - `requireCli: false` ignores both;
    - a `cli_preference` outside the inherited default fails;
    - `cliSource` and `globalConfig` are set;
    - the `globalConfig` snapshot is unchanged after the file is later replaced.
  - A source-scan test: only `src/config/loader.ts` and `src/commands/clean.ts` call
    `loadGlobalConfig` in production code.
  - Model precedence:
    - keep `test/cli-adapters/adapter-config-threading.test.ts` "adapter model takes priority over
      review-level model" unchanged;
    - add loader- or runner-level cases: an inherited global adapter model beats a review `model`;
      the review `model` is used when the effective adapter has none; the reviewer override model
      beats both.
- **INT-001 … INT-004:** implement exactly as `test-plan.md` describes them:
  - INT-001: parity between `loadConfig` and `validateConfig` across nine rows, including check-only
    rows 8–9 and the `requireCli: false` expectations;
  - INT-002: the trust-ledger hash follows the inherited global `cli`;
  - INT-003: the reviewer override on the resolved block;
  - INT-004: the `health` exit matrix across eight states.
- **E2E-001 … E2E-003** in `test/integration/global-config-e2e.test.ts`, run by `bun run test:e2e`:
  - spawn `dist/index.js` with a temp `HOME` and `XDG_CONFIG_HOME` unset, and stub CLIs on `PATH`;
  - E2E-001 covers the adopt/override journey with model-precedence argv assertions;
  - E2E-002 covers the malformed global config hard error across `run`, `check`, `validate`,
    `health`, `skip` and `clean` (including `clean` in an uninitialized directory), with no marker,
    lock, state or trust writes, and a `debug_log`-only global that still works;
  - E2E-003 covers `ci list-jobs` on a clean runner, the missing-everywhere errors, and the legacy
    path;
  - skip when `dist` is not built (`isDistBuilt()`);
  - each suite includes a case where the fixture global file changes the outcome.

## Out of scope

- Field-level merging of `cli` between the global and project configs.
- Global `entry_points`, checks, or reviews.
- `init` changes, including omitting `cli` or dropping review pins.
- A "force global" mode over review `cli_preference`.
- Changing adapter-versus-review model precedence.
- A `config set` command.
- A user-configurable global path (env var or XDG).
- Automated migration tooling.
- Provisioning a global config in generated CI workflows.
- Consolidating the duplicate `debugLogConfigSchema` definitions.
- Changing the `log-management` debug_log precedence.

## Done When

- Every scenario in the three specs under `openspec/changes/feature-168-15449656/specs/` is satisfied:
  - `global-config`: every requirement;
  - `review-config`: the modified "Per-Adapter Configuration" requirement, plus the new `validate`
    and `health` requirements;
  - `reviewer-override`: the modified "Preference replacement and adapter policy" requirement.
- Projects with a valid `cli` block behave as before, apart from the documented malformed-global and
  `health` exit-status changes. Existing tests pass, with only the `LoadedConfig` fixture additions
  and the `global.test.ts` isolation adjustments.
- The test preload isolates every in-process test from the real
  `~/.config/agent-validator/config.yml`, and the sentinel test passes.
- The unit tests, INT-001…INT-004, and E2E-001…E2E-003 exist and pass.
- `bun run test` and `bun run test:e2e` pass, and Biome lint/format is clean.
- The documentation and `skills/validator-help/references/config-troubleshooting.md` are updated as
  described.
- The validator passes on the change: `bun run build:npm && node dist/index.js run`.
