# Design: gauntlet-help skill structure

## Context
`/gauntlet-help` is a diagnostic skill for answering "what happened" and "why" questions about gauntlet behavior. It must work in installed environments where source code may be unavailable.

The design therefore emphasizes:
- source-independent investigation
- prompt-only guidance
- evidence-first diagnosis
- reference files organized by troubleshooting situation

## Goals
- Provide reliable triage for common gauntlet support questions
- Diagnose from runtime artifacts and command output, not source files
- Keep the skill maintainable by splitting guidance into focused situation-based reference files
- Auto-run only the commands needed to disambiguate the issue

## Non-Goals
- No automatic remediation/fixing logic
- No executable helper scripts in this skill
- No requirement to enumerate separate spec scenarios per individual status/check

## Skill File Layout
Reference files are organized by troubleshooting situation so that each file is self-contained for its domain. SKILL.md contains everything that is always needed (evidence sources, output contract, diagnostic workflow, routing logic).

```text
gauntlet-help/
  SKILL.md
  references/
    stop-hook-troubleshooting.md
    config-troubleshooting.md
    gate-troubleshooting.md
    lock-troubleshooting.md
    adapter-troubleshooting.md
    ci-pr-troubleshooting.md
```

### File Responsibilities

#### `SKILL.md` (always loaded)
Contains everything needed for every diagnostic invocation:
- Invocation scope (diagnosis-only, prompt-only)
- Evidence sources: where to collect signals (`config.yml`, `log_dir`, `.debug.log`, `.execution_state`, gate logs/review JSON, CLI commands)
- Output contract: required response sections (`Diagnosis`, `Evidence`, `Confidence`, `Next steps`) and confidence levels
- Diagnostic workflow: resolve `log_dir` first, passive evidence before commands, confidence labeling
- Routing logic: which reference file to load based on the user's question
- CLI command quick-reference: when to use `list`, `health`, `detect`, `validate`, `clean`

#### `references/stop-hook-troubleshooting.md`
- All stop-hook status values and their meanings (17 statuses)
- Blocking vs allowing statuses
- Common scenarios: "hook blocked my stop", "hook allowed but shouldn't have", "hook seems stuck"
- Recursion prevention (env var, marker file, nested hook detection)
- Timing issues: stdin timeout (5s), hard timeout (5 min), stale markers (10 min), `interval_not_elapsed`
- Environment variable overrides for stop hook behavior
- `stop_hook_disabled` diagnosis

#### `references/config-troubleshooting.md`
- `no_config` — missing `.gauntlet/config.yml`
- Invalid YAML syntax and schema validation failures
- Common misconfigurations: missing `cli.default_preference`, empty `entry_points`, conflicting options (`fail_fast` + `parallel`, conflicting fix instruction fields)
- `log_dir` misconfiguration (can't find logs)
- Check/review YAML errors (missing command, invalid paths)
- `base_branch` misconfiguration
- Config precedence (env > project > global > defaults)
- Init setup problems (directory exists, git not initialized, no remote)

#### `references/gate-troubleshooting.md`
- Check gate failures: command not found, timeout, non-zero exit code, output truncation (10MB buffer)
- Review gate failures: no healthy adapters, JSON parsing errors, violations outside diff scope
- `no_applicable_gates` — no entry points matched changes
- `no_changes` — no changes detected in watched files
- Parallel vs sequential execution and `fail_fast` behavior
- Rerun/verification mode — how it works, why violations aren't detected on rerun
- `rerun_new_issue_threshold` — severity filtering for new issues
- How to read check logs and review JSON

#### `references/lock-troubleshooting.md`
- `lock_conflict` — another gauntlet run in progress
- Stale lock detection (PID dead or lock > 10 min old) and auto-cleanup
- `allow_parallel` config interaction
- `.gauntlet-run.lock` and `.stop-hook-active` marker files
- Manual cleanup with `agent-gauntlet clean`

#### `references/adapter-troubleshooting.md`
- `agent-gauntlet health` output interpretation
- Missing CLI tools (not in PATH)
- Authentication issues
- Usage limit exceeded and 1-hour cooldown mechanism
- Cooldown tracking in `.execution_state` (`unhealthy_adapters` with `marked_at` timestamps)
- `cli.default_preference` and adapter selection order
- `allow_tool_use` and `thinking_budget` settings

#### `references/ci-pr-troubleshooting.md`
- `pr_push_required` — gates passed but PR needs push
- `ci_pending` / `ci_failed` / `ci_passed` / `ci_timeout` statuses
- `auto_push_pr` and `auto_fix_pr` config requirements (`auto_fix_pr` requires `auto_push_pr`)
- `max_ci_wait_attempts` (3 attempts) and `.ci-wait-attempts` tracking file
- CI detection environment variables (`CI`, `GITHUB_ACTIONS`, `GITHUB_BASE_REF`)
- How `wait-ci` works and when it triggers

## Per-File Content Guidance

### `SKILL.md`
- Define invocation scope as diagnosis-only and prompt-only.
- Include evidence sources inline: list all required files/paths, what each confirms, and when to run diagnostic CLI commands.
- Include output contract inline: `Diagnosis`, `Evidence`, `Confidence` (`high`/`medium`/`low`), `Next steps`, and confidence downgrade criteria.
- Define the diagnostic workflow: resolve `log_dir` from `.gauntlet/config.yml` first, start with passive evidence, invoke commands only when needed.
- Route to the appropriate reference file based on the user's question or observed status.

### Reference files (all)
- Each file is self-contained for its troubleshooting domain.
- Include the status values, failure modes, likely causes, and verification signals relevant to that domain.
- Prefer actionable checks over implementation-level internals.
- Map common user questions to minimum evidence needed and likely next commands.

## Investigation Strategy
1. Read `.gauntlet/config.yml` and resolve `log_dir`.
2. Start with passive evidence from logs/state (`.debug.log`, `.execution_state`, latest gate/review logs).
3. Run `agent-gauntlet list`, `agent-gauntlet health`, or `agent-gauntlet detect` only when logs/config are insufficient for a confident diagnosis.
4. Return an evidence-backed explanation, clearly distinguishing confirmed findings from inference.

## Installation Model
- Claude installs SHALL include the full `gauntlet-help` skill bundle (`SKILL.md` + `references/`).
- Non-Claude installs remain command-based and are unchanged by this change.

## Compatibility Notes
- The skill must not assume `gauntlet_logs`; it uses configured `log_dir`.
- The skill must include `.execution_state` in diagnostics because it carries important run context (timestamps, branch/commit refs, and optional adapter health state).

## Decisions
- Use a prompt-only skill instead of scripts to keep behavior transparent and easy to iterate in markdown.
- Organize reference files by troubleshooting situation (stop-hook, config, gates, locks, adapters, CI/PR) so each file is self-contained for its domain.
- Include evidence sources and output contract directly in `SKILL.md` because they are needed for every diagnostic invocation — separate files would just add loading overhead with no selective-loading benefit.
- Prefer passive evidence first (config/logs/state) and invoke `list`, `health`, and `detect` only when needed to disambiguate diagnosis.

## Alternatives Considered
- Router + topic-based references (diagnostic-workflow.md, evidence-sources.md, status-playbooks.md, question-playbooks.md, output-contract.md): rejected because every invocation would need to load most or all files, defeating the purpose of progressive loading. Evidence sources and output contract have no reason to be separate files since they're always needed.
- Single-file skill with all guidance in `SKILL.md`: rejected because the total content across all troubleshooting domains would be too large.
- New `agent-gauntlet help` subcommand for diagnosis: rejected for this change because the goal is an in-agent workflow using existing skill infrastructure.
- Bundled parser scripts in `gauntlet-help`: rejected for v1 because the requested scope is prompt-only diagnostics.

## Risks / Trade-offs
- Missing or incomplete evidence files (`.debug.log`, `.execution_state`, or gate logs) can reduce diagnostic confidence.
  - Mitigation: require explicit confidence labeling and next-step evidence requests.
- Misconfigured `log_dir` can lead to false "no data" conclusions.
  - Mitigation: require reading `log_dir` from `.gauntlet/config.yml` before log inspection.
- CLI availability issues can limit command-based diagnostics.
  - Mitigation: treat command failures as evidence and fall back to available artifacts.
