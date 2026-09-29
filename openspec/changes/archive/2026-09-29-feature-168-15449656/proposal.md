## Why

Users who work across many repositories often switch their default review CLI and model for all of
them at once (for example, moving every project from one Codex model to a newer one). Today every
project's `.validator/config.yml` must carry a `cli` block, so a global switch means editing and
committing the same change in every repository. That is slow, noisy in history, and easy to leave
half-done.

The existing escape hatches do not fit:

- `~/.config/agent-validator/config.yml` already exists (`src/config/global.ts`) but only supports
  `debug_log`.
- The reviewer environment overrides (`AGENT_VALIDATOR_REVIEWER_CLI` / `_MODEL` / `_EFFORT`) sit
  *above* project config rather than acting as a default beneath it. They are owned by Agent Runner,
  and hook or agent environments do not reliably inherit shell-profile variables.

The planned rollout is to put the preferred `cli` block in the global config once and then remove
the `cli` block from each project so it inherits the user-level default. A project that needs
something different can still set its own.

**What the global switch does and does not cover.** The global `cli` block is a *default*.
It controls every review that does not pin its own CLI. Model selection keeps today's adapter-first
rule: the effective `cli.adapters.<adapter>.model` (from the project or the inherited global block)
takes priority over a review's own `model`, which is only a fallback. A global adapter model therefore
switches the model for every review on that adapter, including reviews with an `init`-generated
`model` pin. Review-level `cli_preference` pins do not follow the global default. `init` generates
them for GitHub Copilot setups (`cli_preference: ['github-copilot']`). Such a pin must be within the
effective `default_preference`, or loading fails. A project with CLI-pinned reviews therefore needs a
one-time audit when it moves to the global default: remove or adjust those `cli_preference` pins at
the same time as the project `cli` block. After that one-time migration, future switches are a single
edit to the global file.

**Verdict: go with caveats.** The change is small, reuses the existing `cliConfigSchema`, and fits
the existing `debug_log` precedent where project config overrides global config. The caveats:

- A shared repository that removes its `cli` block depends on each developer having a global config.
  Mitigation: a clear error naming both config paths.
- Clean CI runners have no user global config. The generated CI workflow only needs deterministic
  check jobs, so CI job discovery must not require an effective `cli` block (see What Changes).
- Review-level `cli_preference` pins are not overridden by the global default. The rollout requires
  the migration audit described above.
- A malformed global config becomes a hard error for every command that reads it, including
  `debug_log`-only global configs that currently warn and fall back.
- For projects that inherit, changing the global `cli` block changes the effective reviewer config
  that the trust ledger hashes. This matches what happens today when a project edits its own `cli`
  block, so it is intended.

## What Changes

- The global config (`~/.config/agent-validator/config.yml`) accepts an optional `cli` block with the
  same shape as the project `cli` block (`default_preference` + `adapters`).
- `cli` becomes optional in the project config (`.validator/config.yml`, or legacy
  `.gauntlet/config.yml`).
- **Whole-block replacement, no merging.** If the project config contains a `cli` key, that block is
  the effective CLI config and the global `cli` block is ignored entirely. If the project has no
  `cli` key, the global `cli` block is used as-is.
- Effective precedence, highest first:
  - CLI choice: reviewer env override > review `cli_preference` > effective `default_preference`
    (project `cli` if present, else global `cli`).
  - Model: reviewer env override > effective adapter `model` (project or global) > review `model` >
    built-in default. This is today's adapter-first rule, unchanged.
  - Env overrides still apply on top of whichever `cli` block is resolved; their behavior does not
    change.
- **Load-time CLI validation.** The effective CLI config is checked when configuration loads, using
  the same rules as `validate` and `health`: a non-empty `default_preference` and known adapter
  names. Runtime loading, `validate`, and `health` therefore agree. `ci list-jobs` skips these
  checks.
- If neither the project nor the global config provides a `cli` block, loading fails with an error
  that names both config paths. This applies to every command that needs an effective CLI config.
- **CI-safe job discovery.** `agent-validate ci list-jobs` only emits deterministic check jobs and
  never runs reviews, so it does not require an effective `cli` block. It succeeds on a clean runner
  with no global config and a project with no `cli` block. It still fails on a malformed project
  config, or a malformed global config if one exists. The rollout therefore needs no CI workflow
  change and no global config provisioned in CI.
- **Config validation reports the source.** `validate` checks the *effective* CLI config and, on
  success, reports which file it came from (project or global). CLI-related errors name the file
  that supplied the block. The structured validator used by `health` lists the global config among
  the files checked when it exists, attributes CLI issues to their source file, and checks review
  `cli_preference` against the effective `default_preference`.
- **`health` fails on configuration errors.** The "check all supported agents" fallback applies
  only when no project config exists. Any other configuration failure makes `health` print the error
  and exit nonzero. That covers a malformed global config, no effective `cli` block, an invalid
  project config, or config validation errors. It no longer finishes with a seemingly healthy result
  and exit 0.
- **Behavior change:** a global config file that exists but cannot be parsed (invalid YAML or schema
  violation) becomes a hard error instead of a warning with fallback to defaults. This applies to
  every command that reads the global config. A missing global config is still fine.

## Capabilities

### New Capabilities
- `global-config`: loading and validation of the user-level config file, the `cli` block it may
  contain, missing-file vs. invalid-file behavior, and precedence relative to project config
  (covering the existing `debug_log` override and the new `cli` inheritance).

### Modified Capabilities
- `review-config`: the project `cli` block is optional, and the effective CLI config is resolved
  from the project or global config with whole-block replacement. Config validation (`validate`,
  `health`) checks the resolved block, reports its source file, and `health` exits nonzero on
  configuration errors.
- `reviewer-override`: env overrides are applied on top of the resolved (project-or-global) CLI
  config. Behavior is unchanged; the documented precedence gains the global layer.
- CI job discovery (`ci list-jobs`, documented in `docs/ci.md`; no existing spec): does not require
  an effective `cli` block. This will be specified under `review-config` or `global-config` rather
  than as a new capability.

## Technical Approach

- **Schema.** Extend `globalConfigSchema` with `cli: cliConfigSchema.optional()`, and make
  `validatorConfigSchema.cli` optional. No new config shapes are introduced.
- **Single resolution point.** Add one small resolver that takes the parsed project config and the
  global config and returns the effective `cli` block together with its source path. In
  `loadConfig`, call it right after parsing the project config and write the result back to
  `project.cli`, before the existing `default_preference` inference, reviewer-override overlay, and
  `mergeCliPreferences`. Also expose the source (for example, a `cliSource` path on `LoadedConfig`)
  so `validate` can report it. Everything downstream (runner adapter settings, trust-ledger hashing,
  reviewer override) keeps reading `config.project.cli` and needs no changes.
- **CI opt-out.** Add a `loadConfig` option so a caller can declare that it does not need an
  effective CLI config. `ci list-jobs` passes it. With that option and no `cli` block anywhere,
  loading skips the missing-`cli` error and CLI-preference merging for reviews. Loading still
  validates everything else. All other callers keep the strict default.
- **Validator.** `validateConfig` in `src/config/validator.ts` uses the same resolver. The
  "missing `cli`" case becomes an error naming both paths, and CLI issues are reported against the
  source file of the resolved block.
- **Health.** `src/commands/health.ts` distinguishes "project config not found", which keeps the
  all-agents fallback, from every other load or validation failure, which prints the error and sets
  a nonzero exit status. It also sets a nonzero exit status when `validateConfig` reports
  error-severity issues.
- **Global loader strictness.** `loadGlobalConfig` keeps treating `ENOENT` as "no global config". It
  throws a descriptive error, including the global path and the parse or schema reason, on any other
  read, parse, or validation failure. The file is read once per invocation, inside `loadConfig`
  (or at the start of `clean` when there is no project config). That snapshot supplies both `cli`
  and `debug_log`, so `run-executor`, `gate-command`, `skip`, and `clean` no longer re-read it
  after taking a lock.
- **Testability.** Tests need a way to point the global loader at a fixture instead of the real home
  directory. Add an internal seam (for example, an optional path parameter or an injectable resolver)
  without exposing a user-facing configurable path. Test-wide isolation from the real file is a
  prerequisite; `design.md` chooses the exact mechanism.

## Out of Scope

- Changing `init` to omit the project `cli` block, or to stop generating review-level
  `cli_preference` / `model` pins, when a global config exists.
- An opt-in "force global" mode that overrides review-level `cli_preference` settings.
- Changing model precedence between adapter-level and review-level `model`.
- Automated migration tooling that strips project `cli` blocks or review-level pins. The migration
  audit is documented, not automated.
- Global `entry_points`, checks, or reviews.
- Field-level merging of `cli` settings between global and project configs.
- A `config set`-style CLI command for editing the global config.
- A user-configurable global config path (for example, `XDG_CONFIG_HOME` support or an env var).
- Provisioning a global config in generated CI workflows. CI discovery doesn't need one.

## Impact

- **Code:** `src/config/global.ts`, `src/config/schema.ts`, `src/config/loader.ts`,
  `src/config/validator.ts`, `src/config/types.ts`, `src/commands/validate.ts`,
  `src/commands/health.ts`, `src/commands/ci/list-jobs.ts`, `src/commands/clean.ts`,
  `src/commands/skip.ts`, `src/commands/gate-command.ts`, `src/core/run-executor.ts` (they use the
  single global snapshot), plus the related tests and a Bun test preload for global-config isolation.
  Other callers of `loadConfig` inherit the behavior without changes.
- **Docs:** `docs/config-reference.md` covers:
  - the global `cli` block;
  - precedence and whole-block replacement;
  - the hard error on an invalid global config;
  - a migration checklist for removing a project `cli` block, including auditing review-level
    `cli_preference` and `model` pins.

  `docs/ci.md` notes that CI discovery needs no global config. Troubleshooting notes cover the
  "no `cli` block found" error.
- **Users:**
  - Projects that keep their `cli` block are fully backward compatible.
  - A shared repo that removes its `cli` block depends on each developer's global config. A
    developer without one gets a clear error naming both paths.
  - Projects whose reviews pin a CLI (`cli_preference`) must adjust those pins to benefit from the
    global default.
  - Runtime loading now rejects an empty or invalid effective `cli` block, which `health` already
    reported as invalid. This covers projects that keep their `cli` block but have an empty
    `default_preference` or an unknown tool; they previously loaded.
  - Users with a malformed global config (even `debug_log`-only) now get a hard error instead of a
    warning.
  - `health` now exits nonzero on configuration errors instead of falling back to the all-agents
    check.
- **CI:** generated workflows keep working on clean runners after a project removes its `cli` block.
- **Trust ledger:** the config hash covers the effective `cli` block, so changing the global `cli`
  block changes the hash for inheriting projects.
- **Dependencies:** none added.
