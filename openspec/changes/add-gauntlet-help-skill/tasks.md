## 0. Pre-factoring

No hotspots modified.

## 1. Implementation

- [x] 1.1 Create `.claude/skills/gauntlet-help/SKILL.md` with: diagnosis-only scope, evidence sources (config.yml, log_dir, .debug.log, .execution_state, gate/review logs, CLI commands), output contract (Diagnosis/Evidence/Confidence/Next steps), diagnostic workflow (log_dir-first, passive-then-active), routing logic for reference files, and CLI command quick-reference
- [x] 1.2 Create `.claude/skills/gauntlet-help/references/stop-hook-troubleshooting.md` covering all 17 stop-hook statuses, blocking vs allowing, recursion prevention, timing issues, env var overrides, and common "why was I blocked/allowed" scenarios
- [x] 1.3 Create `.claude/skills/gauntlet-help/references/config-troubleshooting.md` covering missing config, YAML/schema errors, common misconfigurations (cli.default_preference, entry_points, fail_fast+parallel, fix instruction conflicts), log_dir issues, config precedence, and init setup problems
- [x] 1.4 Create `.claude/skills/gauntlet-help/references/gate-troubleshooting.md` covering check failures (command not found, timeout, exit codes, truncation), review failures (no adapters, JSON parsing, out-of-diff violations), no_applicable_gates, no_changes, parallel/sequential/fail_fast behavior, rerun mode, and log interpretation
- [x] 1.5 Create `.claude/skills/gauntlet-help/references/lock-troubleshooting.md` covering lock_conflict, stale lock detection/cleanup, allow_parallel config, marker files (.gauntlet-run.lock, .stop-hook-active), and manual cleanup
- [x] 1.6 Create `.claude/skills/gauntlet-help/references/adapter-troubleshooting.md` covering health command output, missing tools, auth issues, usage limits and 1-hour cooldown, .execution_state unhealthy_adapters, cli.default_preference selection, and adapter settings
- [x] 1.7 Create `.claude/skills/gauntlet-help/references/ci-pr-troubleshooting.md` covering pr_push_required, ci_pending/ci_failed/ci_passed/ci_timeout, auto_push_pr/auto_fix_pr config, max wait attempts, CI env vars, and wait-ci behavior
- [x] 1.8 Update init installation so Claude installs include the full `gauntlet-help` bundle (`SKILL.md` + `references/`) alongside existing gauntlet skills
- [x] 1.9 Keep non-Claude installation behavior unchanged
- [x] 1.10 Update skills documentation to include `/gauntlet-help` and its diagnostic scope

## 2. Tests

- [x] 2.1 Test: init installs `.claude/skills/gauntlet-help/SKILL.md` for Claude
- [x] 2.2 Test: init installs all 6 `references/` files for `gauntlet-help`
- [x] 2.3 Test: non-Claude installs do not gain unexpected `gauntlet-help` files

## 3. Validation

If there is a "Pre-factoring" section above, confirm those refactorings are complete before marking the task complete.
If there is a "Manual Verification" section above, complete all verification steps before marking the task complete.

There are no automated validation tasks that need to be explicitly run. When work is completed, a stop hook should execute the full gauntlet of verification tasks and give direction on what needs to be fixed.
