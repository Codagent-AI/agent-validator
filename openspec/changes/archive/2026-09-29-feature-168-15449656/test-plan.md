## Coverage Strategy

Specifications remain the source of unit-test requirements. This plan records only additional
integration and end-to-end obligations, the acceptance testing envelope, and exceptional human-only
obligations.

Unit tests (per the specs and `design.md` §Test strategy) carry most of the weight:

- global config reading and error classification (`readGlobalConfig` / `loadGlobalConfig`);
- `resolveEffectiveCli` (project wins, including `{}`; global fallback; none; returned copy);
- the loader resolution matrix via the `globalConfigPath` seam;
- validator issue attribution;
- the `requireCli: false` option.

The obligations below cover what unit tests cannot prove on their own:

- the resolved block actually reaches the adapter command line;
- runtime loading and structured validation agree;
- the trust-ledger hash follows the resolved block;
- public commands expose the promised exit statuses and messages;
- the built binary really reads `~/.config/agent-validator/config.yml` from the user's home directory.

**Home isolation (a prerequisite for every obligation below and for all existing suites).** No test
may read or write the real `~/.config/agent-validator/config.yml`:

- In-process tests are covered by the Bun test preload (`test/setup/isolate-global-config.ts` via
  `bunfig.toml`). It points `getGlobalConfigPath()` at a non-existent file in a fresh temp dir using
  the test-only `setGlobalConfigPathForTests` override, and leaves `HOME` alone.
- Tests that need a global file pass `globalConfigPath` or set the override, and restore the preload
  value afterwards.
- A sentinel test asserts that the preloaded path is under the OS temp dir.
- Spawned tests set `HOME` (and unset `XDG_CONFIG_HOME`) in the child environment. Each spawned suite
  includes at least one case where a fixture global file changes the outcome, which proves the
  redirected home is honored.

## Integration Tests

### INT-001: Runtime loading and structured validation agree on the effective CLI config
- Covers: global-config "Effective CLI config resolution", "Missing effective CLI config", "Global CLI block"; review-config "Validate command reports the effective CLI config source" (attribution half).
- Boundary: `loadConfig` and `validateConfig` both reading real temp files through the shared `resolveEffectiveCli`.
- Setup: a table of temp project dirs, each paired with a temp global config file passed via `globalConfigPath`. Rows:
  1. project `cli` present + global `cli` present;
  2. project without `cli` + valid global `cli`;
  3. project `cli: {}` + global `cli` present;
  4. no `cli` anywhere;
  5. project without `cli` + global `default_preference: [not-a-tool]`;
  6. project without `cli` + review `cli_preference` outside the global `default_preference`;
  7. legacy `.gauntlet/config.yml` without `cli` and no global `cli`;
  8. check-only project (no reviews) with `cli: {}` + no global `cli`;
  9. check-only project without `cli` + global `default_preference: [not-a-tool]`.
- Action: for each row, call `loadConfig(dir, { globalConfigPath })` and `validateConfig(dir, { globalConfigPath })`.
- Assertions:
  - For every row, `loadConfig` succeeds iff `validateConfig().valid` is true.
  - On success, `loadConfig().cliSource.kind`/`path` match the expected file.
  - Rows 3, 5, 8 and 9 are rejected by both `loadConfig` and `validateConfig`, even without reviews.
  - Error rows name the expected file: the project path for rows 3 and 8, the global path for rows 5 and 9, the review file for row 6, and both paths for rows 4 and 7 (row 7 names `.gauntlet/config.yml`).
  - With `requireCli: false`, rows 3, 4, 8 and 9 load successfully.
  - When a global file exists, `filesChecked` includes it.
- Execution: `test/config/cli-resolution-parity.test.ts`, part of `bun run test`.

### INT-002: Trust-ledger scope follows the inherited global CLI block
- Covers: global-config scenario "Changing the global cli changes the trust scope for inheriting projects"; design decision D3.
- Boundary: `loadConfig` → trust-ledger scope/config-hash computation (`src/utils/trust-ledger.ts`) on real loaded config.
- Setup: temp git repo with a project config that has no `cli` block. Two temp global files, identical except `default_preference: [codex]` vs `[claude]`. A third case: the project defines its own `cli` while the global file varies.
- Action: load the config with each global file and compute the trust scope/config hash for the same tree, using the ledger's public helpers (as existing trust-ledger tests do).
- Assertions:
  - The hashes differ between the two inheriting loads.
  - When the project defines `cli`, changing the global `cli` does not change the hash.
- Execution: next to the existing trust-ledger tests under `test/utils/`, part of `bun run test`.

### INT-003: Reviewer override overlays the resolved (global) CLI block without leaking into it
- Covers: reviewer-override modified "Preference replacement and adapter policy" (all three new scenarios).
- Boundary: `loadConfig(..., { applyReviewerOverride: true, globalConfigPath })` with real env parsing (`parseReviewerOverrideEnv`) and `applyReviewerOverrideToConfig`.
- Setup: temp project without `cli` and a global `cli` with `default_preference: [codex]` and `adapters.claude.allow_tool_use: true`. Set `AGENT_VALIDATOR_REVIEWER_CLI=claude` in `process.env` for the test only, and restore it after.
- Action:
  1. Load the config.
  2. Load it again with a project `cli` block (`default_preference: [codex]`, no `adapters.claude`).
  3. Load with no `cli` anywhere.
- Assertions:
  - Case 1: `project.cli.default_preference` is `[claude]`, `adapters.claude.allow_tool_use` is `true`, and the global config object re-read from disk is unchanged. The overlay wrote no file, so the global file bytes are identical.
  - Case 2: `adapters.claude.allow_tool_use` is `false` (init defaults) and does not come from the global block.
  - Case 3: loading fails with the missing-CLI error naming both paths.
- Execution: `test/config/reviewer-override-overlay.test.ts` (extend), part of `bun run test`.

### INT-004: `health` exit status and fallback across configuration states
- Covers: review-config "Health reports configuration errors with a failing exit status" (all scenarios).
- Boundary: the registered `health` Commander action → `validateConfig` + `loadConfig` + adapter health checks, in-process, as in `test/commands/health.test.ts`.
- Setup: temp project dirs, and temp global files installed with the test-only path override. Stub adapter health through the existing test pattern, with no real CLI calls. States:
  1. valid project + malformed global YAML;
  2. project without `cli` + no global `cli`;
  3. project without `cli` + valid global `cli` `[codex]`;
  4. no project config + no global file;
  5. no project config + malformed global;
  6. project config with invalid YAML;
  7. check-only project with `cli: {}`;
  8. check-only project without `cli` + global `default_preference: [not-a-tool]`.
- Action: invoke `health` for each state and capture stdout/stderr and `process.exitCode`/exit calls.
- Assertions:
  - States 1, 2, 5, 6, 7 and 8 set a nonzero exit status. Their output names the offending file(s) (both paths for state 2), and they do not print the "Config not found, checking all supported agents" fallback. State 5 is the exception on the fallback: it may print it, because there is no project config, but it still exits nonzero.
  - State 3 lists the global file among the files checked, reports Codex, and exits 0.
  - State 4 prints the fallback and exits 0.
- Execution: `test/commands/health.test.ts` (extend), part of `bun run test`.

## End-to-End Tests

### E2E-001: Adopting the global default, then overriding it per project
- Covers: global-config "Global CLI block", "Effective CLI config resolution" (inherit and whole-block replacement, including no adapter merge), "CLI settings precedence"; review-config "Per-Adapter Configuration" (new scenarios), "Validate command reports the effective CLI config source".
- Surface: built binary `dist/index.js` via `spawnValidator` (`run`, `validate`).
- Setup:
  - temp git repo (`initGitRepo`) with a change against `base`, and a project config with no `cli` block, one check, and one review with no `cli_preference`;
  - temp `HOME` containing `.config/agent-validator/config.yml` with `cli.default_preference: [codex]` and `adapters.codex: { model: gpt-6-sol, thinking_budget: low, allow_tool_use: false }`;
  - `PATH` prefixed with the argv-recording stubs from `createReviewerOverrideStubs`/`createRecordingCodexStub`;
  - reviewer-override env vars removed.
- Journey:
  1. Run `validate`.
  2. Run `run`.
  3. Add a project `cli` block (`default_preference: [claude]`, no adapters) and run `validate` then `run` again.
  4. Replace it with a project `cli` block `default_preference: [codex]` plus `adapters.codex.thinking_budget: high` (no model), and run `run`.
- Assertions:
  - Step 1 exits 0, and its output names the temp global path and identifies it as the global config.
  - Step 2 invokes Codex. The captured argv contains the model `gpt-6-sol` and reasoning effort `low`, and Claude is not invoked.
  - Step 3: `validate` names the project config path, the review runs on Claude, and Codex is not invoked.
  - Step 4: the Codex argv has reasoning effort `high` and no `gpt-6-sol` model.
  - Model precedence (a second review with `model: gpt-5.3-codex` exists throughout):
    - in step 2, both reviews' Codex argv use `gpt-6-sol`, because the inherited adapter model beats the review model;
    - in step 4, the pinned review uses `gpt-5.3-codex`, because the effective adapter block has no model;
    - a final `run` of the step 2 setup with `AGENT_VALIDATOR_REVIEWER_CLI=codex` and `AGENT_VALIDATOR_REVIEWER_MODEL=gpt-7` uses `gpt-7` for both reviews.
  - The global file's bytes are unchanged after all steps.
- Execution: `test/integration/global-config-e2e.test.ts`, run by `bun run test:e2e` (after `build:npm`); skipped when `dist` is not built, following the existing `isDistBuilt()` pattern.

### E2E-002: A malformed global config is a hard error before any gate or state
- Covers: global-config "Global config file loading" (malformed YAML, schema-invalid, reported even with project `cli`, debug_log-only still works); review-config health/validate failure behavior through the real binary.
- Surface: built binary: `run`, `check`, `validate`, `health`, `skip`, `clean`.
- Setup:
  - temp git repo with a valid project `cli` block and a check that writes a marker file;
  - temp `HOME` whose global config is invalid YAML (second pass: `debug_log.enabled: "yes"`; third pass: a valid `debug_log`-only file);
  - stub CLIs on `PATH`.
- Journey: invoke each command in turn with the malformed global file. Then, in a separate empty directory with no project config and no log directory, invoke `clean` with the same malformed file. Finally repeat `run` with the valid `debug_log`-only file.
- Assertions:
  - With the malformed file, every command exits nonzero, and its stderr/stdout contains the absolute temp global path and the parse or field reason.
  - The check marker file is never created.
  - `clean` in the uninitialized directory exits nonzero naming the global path, and does not print the "Logs archived successfully." message.
  - No lock file, execution-state file, or trust-ledger entry is written in `log_dir`, and `skip` does not advance the baseline.
  - With the `debug_log`-only file, `run` succeeds and the debug log is written as configured.
- Execution: `test/integration/global-config-e2e.test.ts`, `bun run test:e2e`.

### E2E-003: Clean CI runner and missing-everywhere error
- Covers: global-config "CI job listing without CLI config", "Missing effective CLI config" (including the `.gauntlet` legacy path).
- Surface: built binary: `ci list-jobs`, `run`, `validate`.
- Setup:
  - temp repo with a project config with no `cli` block and a `.validator/ci.yml` naming one check;
  - temp `HOME` with no global config;
  - a second repo using legacy `.gauntlet/config.yml` without `cli`.
- Journey:
  1. Run `ci list-jobs`.
  2. Run `run` and `validate`.
  3. Write a malformed global file and rerun `ci list-jobs`.
  4. Run `run` in the legacy repo.
- Assertions:
  - Step 1 exits 0 and prints JSON whose `matrix` contains the configured check job.
  - Step 2 both exit nonzero, naming the project config path and the absolute global path.
  - Step 3 exits nonzero naming the global path.
  - Step 4 names `.gauntlet/config.yml`.
- Execution: `test/integration/global-config-e2e.test.ts`, `bun run test:e2e`.

## Acceptance Testing Envelope

- **Environments and sandboxes:** the local checkout, built with `bun run build:npm` and invoked as `node dist/index.js …` (never an `agent-validate` from `PATH`, per `CLAUDE.md`). Scratch git repositories under the OS temp dir. A scratch home directory is used by setting `HOME` for each invocation.
- **Credentials and secrets:** none required. Review adapters are exercised through stub executables on `PATH` (the helpers in `test/integration/helpers.ts`).
- **Authorized effects:** creating and deleting temp directories, scratch git repos, and scratch `HOME/.config/agent-validator/config.yml` files. Running the validator's own `bun run test` / `bun run test:e2e`. No network calls and no cost. Clean up all temp dirs afterward.
- **Off limits:**
  - the real user's `~/.config/agent-validator/config.yml` (do not create, edit, or delete it);
  - real review CLIs with live model calls (paid, non-deterministic);
  - this repository's own `.validator/config.yml`;
  - publishing, releasing, or pushing.
- **Permitted substitutes:** argv/env-recording stub CLIs instead of real `codex`/`claude`/`gemini`/`copilot` binaries. In-process command invocation where spawning the binary is impractical, provided the `HOME`/`globalConfigPath` isolation rules above hold.
- **Known risk areas:**
  - Model precedence is adapter-first: an inherited global adapter `model` overrides review `model` pins. Confirm that the documentation matches the observed behavior.
  - Stricter load-time CLI validation now rejects already-invalid `cli` blocks at runtime.
  - Does Bun's `os.homedir()` honor an overridden `HOME` in spawned children? E2E isolation relies on it; the outcome-changing fixture case detects failure.
  - The `health` exit-status change also applies to already-invalid project configs (decision S4).
  - `clean` without a project config plus a malformed global file must fail before taking the lock.
  - Trust-hash churn for inheriting projects when the global file changes.
  - The reviewer override mutating the in-memory global object (design decision DS8).
  - Projects with `cli: {}` must not silently inherit.
  - Review-level `cli_preference` pins that `init` generated for Copilot setups fail against an inherited non-Copilot default (expected behavior per PR-2; check that the error message is actionable).

## Human-Only Testing

None.

## Coverage Map

| Requirement or journey | INT | E2E | HT |
| --- | --- | --- | --- |
| global-config: Global config file loading (incl. no-project `clean`) | — | E2E-002 | — |
| global-config: Global CLI block | INT-001 | E2E-001 | — |
| global-config: Effective CLI config resolution | INT-001, INT-002 | E2E-001 | — |
| global-config: Missing effective CLI config | INT-001, INT-003 | E2E-003 | — |
| global-config: CLI settings precedence (CLI choice and model) | INT-001 | E2E-001 | — |
| global-config: Effective CLI config is semantically validated at load | INT-001, INT-004 | — | — |
| global-config: CI job listing without CLI config | — | E2E-003 | — |
| global-config: Global config is never written by Validator | INT-003 | E2E-001 | — |
| review-config: Per-Adapter Configuration (global inheritance scenarios) | — | E2E-001 | — |
| review-config: Validate command reports the effective CLI config source | INT-001 | E2E-001, E2E-003 | — |
| review-config: Health reports configuration errors with a failing exit status | INT-004 | E2E-002 | — |
| reviewer-override: Preference replacement and adapter policy (resolved CLI block) | INT-003 | — | — |
