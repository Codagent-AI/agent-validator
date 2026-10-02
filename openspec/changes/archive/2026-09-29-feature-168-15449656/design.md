## Context

Agent Validator loads configuration in two independent paths:

- **`loadConfig`** (`src/config/loader.ts`) is the runtime path. It is used by `run`, `check`, `review`, `skip`, `clean`, `list`, `detect`, `health`, `update-review`, `validate`, and `ci list-jobs`.
  - It parses `.validator/config.yml` (or legacy `.gauntlet/config.yml`) with `validatorConfigSchema`, which currently **requires** `cli`.
  - It infers `default_preference` from adapter keys.
  - It optionally overlays the reviewer env override (`applyReviewerOverrideToConfig`).
  - It fills each review's `cli_preference` from `default_preference` (`mergeCliPreferences`), throwing if a review names a tool outside it.
- **`validateConfig`** (`src/config/validator.ts`) is a structured, non-throwing validator used only by `health`. It returns `{ valid, issues[], filesChecked[] }`. `validateCliConfig` returns early when `cli` is missing and attributes all CLI issues to the project config path.

The global config (`src/config/global.ts`) is separate from both:

- `GLOBAL_CONFIG_PATH` is computed once at module load from `os.homedir()`.
- `globalConfigSchema` supports only `debug_log`.
- `loadGlobalConfig()` returns defaults for a missing file, and **warns and returns defaults** for an invalid one.
- It is called independently, after `loadConfig`, by `run-executor`, `gate-command`, `skip`, and `clean` to merge `debug_log`.

Everything downstream of `loadConfig` reads `config.project.cli`:

- the runner passes `project.cli?.adapters` to the review executor (`src/core/runner.ts`);
- the trust ledger hashes `project.cli` into `gateAffectingConfig` (`src/utils/trust-ledger.ts`);
- the reviewer override rewrites `project.cli` in memory (`src/config/reviewer-override.ts`).

Command behavior today:

- `health` (`src/commands/health.ts`) prints `validateConfig` results but never sets an exit code for them. It catches every `loadConfig` error except `ReviewerOverrideError` and falls back to checking all adapters.
- `validate` (`src/commands/validate.ts`) only calls `loadConfig` and prints "All config files are valid."
- `clean` recognizes a missing project config by matching the message prefix `Configuration file not found`.

Constraints:
- Test files share one Bun process, so `mock.module()` is discouraged (`test/AGENTS.md`). Tests should use dependency injection instead.
- `skills/` is the distributable source for consumer skill files, installed with checksums by `init`.
- No user-configurable global path (proposal Out of Scope).

## Goals / Non-Goals

**Goals:**
- One resolver decides the effective CLI config (project block, else global block, else none). Both `loadConfig` and `validateConfig` use it, so runtime and validation cannot disagree.
- Downstream consumers (runner, trust ledger, reviewer override, `mergeCliPreferences`, adapter invocation) stay unchanged and keep reading `config.project.cli`. In particular, model selection in `invokeAdapter` (`src/gates/review-runtime-helpers.ts`: `adapterCfg?.model ?? config.model`) is unchanged. The effective adapter model beats a review's `model`, and the reviewer override's model reaches adapters through the overlaid adapter block. The spec's per-field precedence documents this existing rule rather than changing it.
- One semantic validation of the effective CLI block, shared by runtime loading and structured validation.
- One global-config snapshot per invocation, shared by CLI resolution and `debug_log`.
- Global config failures are hard errors with the path and reason. Missing-everywhere errors name both paths.
- `ci list-jobs` works without any `cli` block. `health` exits nonzero on configuration errors. `validate` names the CLI config source.
- No test reads or writes the real `~/.config/agent-validator/config.yml`. This is a prerequisite of the loader change, not a follow-up.

**Non-Goals:**
- Merging `cli` fields between files; global `entry_points`/checks/reviews; `init` changes; a `config set` command; XDG or env-configurable global path; automated migration of review-level pins.
- Consolidating the duplicate `debugLogConfigSchema` definitions in `schema.ts` and `global.ts` (unrelated cleanup).

## Approach

### 1. Global config module (`src/config/global.ts`)

- **Lazy path.** Replace the module-level constant with `getGlobalConfigPath()`, which computes `path.join(os.homedir(), '.config', 'agent-validator', 'config.yml')` on each call. The public name is unchanged.
- **Schema.** `globalConfigSchema` gains `cli: cliConfigSchema.optional()`, imported from `schema.ts`. `schema.ts` imports only `zod`, so there is no import cycle. `GlobalConfig` therefore has `cli?: CLIConfig`.
- **Non-throwing reader** (used by the validator):
  ```ts
  export type GlobalConfigReadResult =
    | { status: 'missing'; path: string }
    | { status: 'ok'; path: string; config: GlobalConfig }
    | { status: 'invalid'; path: string; reason: string; issues: { message: string; field?: string }[] };
  export async function readGlobalConfig(configPath = getGlobalConfigPath()): Promise<GlobalConfigReadResult>;
  ```
  - `ENOENT` → `missing`.
  - Any other read error, a YAML parse error, or a `ZodError` → `invalid`. `issues` holds one entry per Zod issue (field = joined path), or one entry for read/YAML errors.
  - An empty file (`YAML.parse` → `null`/`undefined`) is treated as `{}`, so the `debug_log` defaults apply. This matches today's intent that an empty file is not an error.
- **Test-only path override.** Add `setGlobalConfigPathForTests(path: string | undefined)`, exported with a `ForTests` name and not wired to any env var or CLI flag. When set, `getGlobalConfigPath()` returns it. A Bun test preload uses it (see Test strategy).
- **Throwing loader** (used at runtime):
  ```ts
  export class GlobalConfigError extends Error { readonly path: string; }
  export async function loadGlobalConfig(configPath = getGlobalConfigPath()): Promise<GlobalConfig>;
  ```
  It returns `DEFAULT_GLOBAL_CONFIG` for `missing` and `config` for `ok`. For `invalid` it throws `GlobalConfigError` with the message `Invalid global config at <absolute path>: <reason>`. The reason lists each `field: message`, or the YAML/read error text. The console warning is removed.

### 2. CLI resolution module (new `src/config/cli-resolution.ts`)

```ts
export type CliSourceKind = 'project' | 'global';
export interface CliSource { kind: CliSourceKind; path: string }
export interface ResolvedCli { cli: CLIConfig; source: CliSource }

export function resolveEffectiveCli(args: {
  projectCli: CLIConfig | undefined; projectConfigPath: string;
  globalCli: CLIConfig | undefined;  globalConfigPath: string;
}): ResolvedCli | undefined;

export class MissingCliConfigError extends Error {}  // message built by missingCliConfigMessage
export function missingCliConfigMessage(projectConfigPath: string, globalConfigPath: string): string;
// e.g. 'No "cli" block found. Add a cli block to .validator/config.yml (project) or
//        /home/u/.config/agent-validator/config.yml (global).'

export function describeCliSource(source: CliSource): string; // "<path> (project config)" / "<path> (global config)"

// Shared semantic rules, moved here from validator.ts validateCliConfig / loader.ts inference.
export function inferDefaultPreference(cli: CLIConfig): CLIConfig;  // default_preference ??= adapter keys (if any)
export interface CliIssue { field: string; message: string }        // e.g. field 'cli.default_preference[0]'
export function validateCliSemantics(cli: CLIConfig): CliIssue[];    // non-empty default_preference; tools ∈ getValidCLITools()
export class InvalidCliConfigError extends Error { readonly path: string; readonly issues: CliIssue[] }
```

Resolution rule: if `projectCli !== undefined`, use the project block. Otherwise, if `globalCli !== undefined`, use the global block. Otherwise return `undefined`.

A project `cli: {}` parses to `{}`, not `undefined`, so it wins and later fails the existing "default_preference required" rule (spec: "Present but incomplete project cli"). A bare `cli:` (YAML `null`) is a schema error, as it is today. The resolver returns a shallow clone of the chosen block (`{ ...cli, adapters: cli.adapters && { ...cli.adapters } }`), so in-memory mutation by default-preference inference or the reviewer overlay never touches the parsed global object.

### 3. Loader (`src/config/loader.ts`)

- **Schema.** `validatorConfigSchema.cli` becomes `cliConfigSchema.optional()`.
- **Types.** Add a loaded project type, `LoadedProjectConfig = NormalizedValidatorConfig & { cli: CLIConfig }`. `LoadedConfig.project` becomes `LoadedProjectConfig`, so `project.cli` stays non-optional for every downstream consumer. `LoadedConfig` gains an optional `cliSource?: CliSource`. It is optional so existing hand-built `LoadedConfig` fixtures in tests stay valid; `loadConfig` always sets it when a block was resolved.
- **Errors.** Add `export class ProjectConfigNotFoundError extends Error`. It keeps the existing message `Configuration file not found at <path>` so any message matching elsewhere keeps working. Also add `export function isProjectConfigNotFound(e): boolean`. `clean.ts` switches its private `isMissingConfig` to this helper.
- **Options.** `LoadConfigOptions` gains:
  - `requireCli?: boolean`, default `true`. Only `ci list-jobs` passes `false`.
  - `globalConfigPath?: string`, a test seam that defaults to `getGlobalConfigPath()`.
- **New `loadConfig` flow:**
  1. Resolve the project config path. If it is missing, throw `ProjectConfigNotFoundError` (unchanged ordering).
  2. Parse the project YAML with `validatorConfigSchema` (unchanged).
  3. `const globalConfig = await loadGlobalConfig(options.globalConfigPath)`. This throws `GlobalConfigError` on an invalid file, even when the project has `cli` (decision S1).
  4. `const resolved = resolveEffectiveCli({...})`.
     - If `resolved` is undefined and `requireCli !== false`, throw `MissingCliConfigError(missingCliConfigMessage(projectConfigPath, globalConfigPath))`.
     - If it is undefined and `requireCli === false`, set `cli = {}` and mark CLI as absent.
  5. Set `projectConfig.cli = inferDefaultPreference(resolved.cli)`, then run `validateCliSemantics`. If it returns issues and `requireCli !== false`, throw `InvalidCliConfigError` with message `Invalid cli config in <describeCliSource>: <field>: <message>; …`. This runs before any gate, lock, or state write, and before the reviewer overlay, so it validates the configured block the same way `validate` does, whether or not the project has reviews. With `requireCli === false` (only `ci list-jobs`), semantic issues are ignored, the overlay and `mergeCliPreferences` are skipped, and `project.cli` is left as resolved (or `{}`).
  6. Extract inline gates, load checks, and load reviews (unchanged).
  7. Apply the reviewer override (unchanged; now operates on the resolved block), then run `mergeCliPreferences`. Both are skipped only in the `requireCli === false` + no-CLI case. `ci list-jobs` never applies the override anyway.
  8. Validate entry-point references (unchanged), and return `{ project, checks, reviews, globalConfig, cliSource: resolved?.source, reviewerOverride? }`.

  `LoadedConfig` gains a required `globalConfig: GlobalConfig`: the single snapshot read in step 3. This is a required field, so the five test files that hand-build `LoadedConfig` add `globalConfig: DEFAULT_GLOBAL_CONFIG`.

  `mergeCliPreferences` error text changes from "project-level allowed list" to name the source: `... not in the allowed list (cli.default_preference in <describeCliSource>)`. The spec's cli_preference-outside-default scenario only requires that loading fails and names the tool.

### 4. Structured validator (`src/config/validator.ts`)

- `validateConfig(rootDir = process.cwd(), options: { globalConfigPath?: string } = {})`.
- `ValidationResult` gains `projectConfigFound: boolean`.
- After project parsing, call `readGlobalConfig(options.globalConfigPath)`:
  - `ok`: push the path onto `filesChecked`.
  - `invalid`: push the path onto `filesChecked`, and push each issue with `file = global path`, severity `error`.
  - `missing`: nothing.
- Replace the early return in `validateCliConfig` with resolution through `resolveEffectiveCli`. Only a parse-valid global block participates; an invalid global has already produced errors.
  - If there is no resolved block and the project config was parsed, push an error with `file = project config path`, `field = 'cli'`, and the `missingCliConfigMessage` text.
  - If a block is resolved, apply `inferDefaultPreference` + `validateCliSemantics`, the same functions the loader uses, and map each `CliIssue` to a `ValidationIssue` with `file = source.path`. The old inline checks in `validateCliConfig` are deleted. Check review `cli_preference` against the effective `default_preference`, still attributed to the review file, and change the message to reference the source file instead of "config.yml".
- The ambiguous-when-project-missing case: if the project config is not found, CLI validation is skipped (as today). The global file is still read and validated as a file.

### 5. Commands

- **`validate`** (`src/commands/validate.ts`): unchanged structure. After `loadConfig()` succeeds, print `All config files are valid.` and then `CLI config: <describeCliSource(config.cliSource)>`. Errors (including `GlobalConfigError` and `MissingCliConfigError`) print through the existing `Validation failed:` path with exit code 1.
- **`health`** (`src/commands/health.ts`):
  - `validateAndDisplayConfig()` returns the `ValidationResult`. Files checked now include the global path when present.
  - Agent checks change as follows:
    ```
    try { await checkConfiguredAgentsHealth(); }
    catch (e) {
      if (e instanceof ReviewerOverrideError) { print; process.exit(1); }   // unchanged
      if (isProjectConfigNotFound(e)) await checkAllAgentsHealth();       // fallback kept only here
      else { console.error(chalk.red('Error:'), message); loadFailed = true; }
    }
    ```
  - Exit status: set `process.exitCode = 1` when `loadFailed`, or when the validation has error-severity issues and either `projectConfigFound` is true or any error issue's `file` is the global path. The existing "Config file not found" issue therefore does not fail a pre-`init` health check, but a broken global file does (spec: "Health without a project config keeps the fallback").
  - The command uses `process.exitCode` rather than `process.exit()` so output flushes, as `validate` already does.
- **`ci list-jobs`** (`src/commands/ci/list-jobs.ts`): `loadConfig(process.cwd(), { requireCli: false })`. Nothing else changes.
- **`run-executor`, `gate-command`, `skip`:** stop calling `loadGlobalConfig()`. Use `config.globalConfig.debug_log` in `mergeDebugLogConfig`. The global file is therefore read exactly once per invocation, inside `loadConfig`, before any lock. `run`'s later `initRunContext` (after the lock and startup reconciliation) can no longer fail on, or read a different version of, the global file.
- **`clean`:** use `isProjectConfigNotFound`.
  - When a project config loads, use `config.globalConfig`.
  - In the missing-project branch, call `loadGlobalConfig()` immediately, before the log-directory existence check and its early "Logs archived successfully." return. A malformed global file therefore fails `clean` even in an uninitialized directory with no logs. The resulting snapshot is reused for `debug_log`, so `clean` also reads the file once.

### Data flow

```
.validator/config.yml ──parse──► project (cli?)          ~/.config/agent-validator/config.yml
                                      │                          │ loadGlobalConfig (throws if invalid)
                                      ▼                          ▼
                              resolveEffectiveCli(project.cli, global.cli)
                                      │ undefined → MissingCliConfigError (unless requireCli:false)
                                      ▼
            project.cli = inferDefaultPreference(resolved.cli) ; cliSource ; globalConfig snapshot
                                      │ validateCliSemantics → InvalidCliConfigError (unless requireCli:false)
                                      │
                        reviewer overlay → mergeCliPreferences
                                      │
              runner adapters · trust-ledger hash · health · list/detect (unchanged readers)
```

### Test strategy

- **Unit, `global.ts`:** missing file; valid `debug_log`-only; valid `cli`; invalid YAML; schema-invalid field; empty file. Assert `GlobalConfigError.path` and message content. Use temp files passed via the `configPath` parameter, never the real home.
- **Test isolation (prerequisite, lands with or before the loader change):** add `test/setup/isolate-global-config.ts`, registered as a Bun test preload in `bunfig.toml` (`[test] preload = [...]`). It creates a fresh temp dir and calls `setGlobalConfigPathForTests(<tmp>/config.yml)` (a non-existent file) before any test module runs, so every in-process test sees "no global config" unless it opts in.
  - `HOME` is deliberately left alone, because git identity and other tools depend on it.
  - Tests that need a global file pass `globalConfigPath` or call the setter, and restore the preload value afterwards.
  - `test/config/global.test.ts` may clear the override temporarily to exercise the real `os.homedir()` path with a temp `HOME`.
  - A sentinel test asserts that `getGlobalConfigPath()` under the preload points inside the OS temp dir and not under the real home.
  - Spawned E2E children never see the override; they set `HOME` explicitly.
- **Unit, `cli-resolution.ts`:**
  - project wins, including `{}`;
  - global used when project is absent;
  - none → `undefined`;
  - the returned block is a copy (mutating it leaves the global object unchanged);
  - message names both paths;
  - `validateCliSemantics`: empty preference, unknown tool, valid block;
  - `inferDefaultPreference` with and without adapters.
- **Loader tests** (temp project dir + `globalConfigPath` fixture):
  - inherit global;
  - project replaces global with no adapter merge;
  - `cli: {}` does not inherit;
  - a malformed global fails even with project `cli`;
  - no `cli` anywhere names both paths (including the legacy `.gauntlet` path);
  - `requireCli: false` succeeds with no `cli`;
  - a review `cli_preference` outside the inherited default fails;
  - the reviewer override applies on top of inherited global (`allow_tool_use` kept from global `adapters.claude`) and is not used when the project `cli` is present;
  - a mutated override does not alter the global object;
  - `cliSource` and `globalConfig` are set correctly;
  - `cli: {}` and an inherited `default_preference: [not-a-tool]` fail loading even with no reviews (`InvalidCliConfigError` naming the source path);
  - `requireCli: false` ignores both.
- **Validator tests:** `filesChecked` includes the global file; an invalid global block issue is attributed to the global path; the missing-everywhere issue; `projectConfigFound`.
- **Command tests:**
  - `validate` prints the source line;
  - `health` exit codes for malformed global, missing `cli`, invalid project config, no project config (exit 0), and inherited healthy (exit 0);
  - `ci list-jobs` with no `cli` anywhere emits the matrix;
  - `validate` and `health` both reject `cli: {}` and an inherited invalid tool in a project with no reviews;
  - `clean` with no project config, no log dir, and a malformed global file exits nonzero;
  - single snapshot: no production module other than `loader.ts` and `clean.ts`'s missing-project branch calls `loadGlobalConfig`, enforced by a small source-scan unit test. Plus a loader test that `LoadedConfig.globalConfig` reflects the file as read, and stays unchanged when the file is later replaced with invalid YAML.
- **Model precedence regression:** keep `test/cli-adapters/adapter-config-threading.test.ts` "adapter model takes priority over review-level model" unchanged. Add loader/runner-level coverage that an inherited global adapter model beats a review `model`, that a review `model` is used when the effective adapter has none, and that the reviewer override model beats both.
  - Follow existing command-test patterns and inject `globalConfigPath` through an env-free seam. Where a command test can't pass options, set `HOME` to a temp dir; the lazy `getGlobalConfigPath()` makes that effective.
- **Trust ledger:** one test that a different inherited global `default_preference` yields a different config hash for the same tree.
- **Existing suites:** covered by the preload. Existing tests that call `loadConfig()` without a seam now see a non-existent global file, which reproduces their current behavior (all fixtures define a project `cli`).

### Documentation

- `docs/config-reference.md`:
  - `cli` becomes optional in the Top-Level Fields table;
  - a new "Global Config" section covering location, the `cli` block, whole-block replacement, the precedence list, and hard errors;
  - a migration checklist: remove the project `cli` block and audit review-level `cli_preference` pins (`init`-generated Copilot setups). Explain that review `model` pins are overridden by a global adapter `model` and only apply when the effective adapter block sets no model.
- `docs/ci.md`: CI job discovery needs no `cli` block or global config.
- `docs/troubleshooting.md` and `skills/validator-help/references/config-troubleshooting.md`: the "No `cli` block found" error, the invalid global config error, and `health` now exiting nonzero.
- `docs/cli-reference.md`: note the `validate` source line and the `health` exit status if those commands are described there.

## Decisions

1. **One shared resolver, written back into `project.cli`.** Downstream readers stay unchanged, and `loadConfig` and `validateConfig` cannot diverge. The alternative, a separate `effectiveCli` field, would touch the runner, trust ledger, reviewer override, and health for no behavioral gain.
2. **The global file is read on every `loadConfig`, before resolution, regardless of project `cli`** (spec decision S1). One code path, and a broken file is surfaced immediately.
3. **Non-throwing `readGlobalConfig` plus throwing `loadGlobalConfig`.** The structured validator needs issues rather than exceptions; runtime callers need a hard error. The throwing variant is built on the non-throwing one, so parsing rules exist once.
4. **Typed errors (`GlobalConfigError`, `MissingCliConfigError`, `ProjectConfigNotFoundError`).** `health` and `clean` distinguish "no project config" from real failures by type, not by message prefix. `ProjectConfigNotFoundError` keeps the old message text for compatibility.
5. **`requireCli: false` as a narrow opt-out used only by `ci list-jobs`.** This keeps the strict default for every command that may run reviews, including checks-only `check`, which today already requires `cli`. It avoids a lazy-error model that would weaken `validate`.
6. **Test seam = lazy `getGlobalConfigPath()`, optional `globalConfigPath` parameters** on `loadGlobalConfig`, `readGlobalConfig`, `loadConfig`, and `validateConfig`, **plus a test-only path override installed by a Bun preload.** There is no env var, so no user-facing configurability, and no `mock.module`, per `test/AGENTS.md`. Isolation is mandatory from the start (approach review AR-5). The preload overrides the config path rather than `HOME`, so git and other HOME-dependent tooling in tests are undisturbed.
7. **`cliSource` is optional on `LoadedConfig`; `project.cli` stays required via `LoadedProjectConfig`.** This avoids breaking hand-built fixtures while keeping downstream type safety. In `requireCli: false` mode with no block, `project.cli` is `{}` and `cliSource` is undefined. Only `ci list-jobs` sees that shape, and it reads no CLI data.
8. **One global-config snapshot per invocation, threaded through `LoadedConfig.globalConfig`** (supersedes DS6, approach review AR-4). `run` previously re-read the file after taking the lock, so a mid-command edit could fail after startup effects or mix versions. Only four production callers and five test files change.
9. **`health` uses `process.exitCode`**, consistent with `validate`, with the no-project-config exemption driven by `ValidationResult.projectConfigFound`.
10. **Shared CLI semantic validation (`validateCliSemantics`) enforced at load** (approach review AR-2). Runtime loading previously accepted `cli: {}` and unknown tools that `health` rejected. Now `loadConfig`, `validate`, and `health` agree. This makes runtime loading stricter for already-invalid configs: an empty or unknown `default_preference` previously loaded but could not run reviews correctly.
11. **Model precedence is unchanged: adapter-first** (approach review AR-1). The specs document per-field precedence that matches `invokeAdapter`. Reversing it would break backward compatibility for projects that keep their `cli` block (which the issue promises), and would route override models through a different path. The issue's single precedence line is interpreted per field: review-level settings win for CLI choice, and the adapter block wins for model.

## Risks / Trade-offs

- **Hard error on existing broken global configs.** Users with a malformed `debug_log`-only file now fail every command. Mitigation: the message names the path and reason, and the docs and troubleshooting skill describe the fix. This was accepted in the issue.
- **Test isolation depends on the preload being registered.** If `bunfig.toml`'s preload is removed or bypassed (for example, by running a test file with a different config), tests could read the real file. Mitigation: a sentinel test asserts that the preloaded path is under the OS temp dir.
- **Stricter runtime CLI validation.** Projects with an empty or unknown-tool `default_preference` that previously loaded (and that `health` already flagged) now fail at load. The error names the file and field.
- **Review `model` pins are overridden by an adapter `model`.** This is existing behavior that becomes more visible when the adapter model is inherited globally. It is documented in the migration checklist.
- **Trust-hash churn for inheriting projects.** Changing the global `cli` changes trust scope in every inheriting repo, as intended (decision D3). This should be documented so users aren't surprised by re-runs after editing the global file.
- **`health` exit-code change for already-invalid project configs.** Scripts that call `health` and ignore config errors will now see exit 1. The command is diagnostic, and the change is logged as decision-bearing (S4).
- **In-memory mutation of a shared object.** Mitigated by cloning in the resolver (Approach §2) and covered by a test.
- **Alternative considered: lazy missing-`cli` error at review dispatch.** Rejected (PR-1). It moves failures to mid-run, makes `validate` weaker, and spreads the rule across the runner.

## Migration Plan

- **Existing projects:** no action. Projects that keep a valid `cli` block behave exactly as before, apart from the stricter handling of a malformed global file and the `health` exit status. Projects whose `cli` block is already invalid (empty or unknown `default_preference`) now fail at load instead of only in `health`.
- **Adopting the global default:**
  1. Add a `cli` block to `~/.config/agent-validator/config.yml`.
  2. In each project, remove the `cli` block, and audit review-level `cli_preference` pins (remove them, or align them with the global `default_preference`). Review `model` pins need no change when the global block sets an adapter `model`, which takes priority.
  3. Run `agent-validate validate`. It should report `CLI config: … (global config)`.
- **CI:** no workflow change. `ci list-jobs` does not need a `cli` block.
- **Rollback:** re-add the project `cli` block; the project block always wins. Reverting the release restores the "cli required" schema. Projects that removed their `cli` block would then fail until it is re-added, so the release notes should call this out.

## Open Questions

None. All choices above are resolved from the issue, the specs, and repository conventions.
