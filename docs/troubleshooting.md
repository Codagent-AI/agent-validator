---
title: Troubleshooting
group: Operations
order: 4
description: Diagnose common Agent Validator setup and runtime issues.
---

# Troubleshooting

## Start With Built-In Diagnostics

```bash
agent-validate validate
agent-validate list
agent-validate detect
agent-validate health
agent-validate status
```

Use `/validator-help` from an agent session when you want an evidence-based explanation from logs and state.

## No Config Found

Run from a repository root that contains `.validator/config.yml`, or initialize first:

```bash
agent-validate init
```

Legacy `.gauntlet/config.yml` is detected only when `.validator/` is absent.

## No Gates Run

Common causes:

- no changed files were detected
- no entry point matched the changed files
- the matching entry point has no checks or reviews
- `exclude` patterns removed the changed files
- a disabled review was not activated with `--enable-review`

Use:

```bash
agent-validate detect
```

## Config Validation Fails

Run:

```bash
agent-validate validate
```

Frequent mistakes:

- defining top-level `checks:` or `reviews:` maps instead of inline gates under `entry_points`
- referencing a gate name that is not defined inline or as a file
- using a review `cli_preference` value that is not included in `cli.default_preference`
- setting both `fix_instructions_file` and `fix_with_skill`
- setting both `prompt_file` and `skill_name` on one review

## Review CLI Missing Or Unhealthy

Run:

```bash
agent-validate health
```

Install or authenticate the reported CLI. If an adapter hit a usage limit, Agent Validator records cooldown state in `.execution_state` under `unhealthy_adapters` and skips that adapter until recovery.

## Rerun Does Not Review What You Expected

Existing logs trigger verification mode. If you want to start a new session, archive logs:

```bash
agent-validate clean
```

If you intentionally want to accept the current state without running gates, use:

```bash
agent-validate skip
```

## Lock Conflict

Agent Validator uses a run lock so overlapping validator processes do not corrupt logs or state. If no validator process is active but a lock remains, inspect `<log_dir>/.validator-run.lock` before deleting it.

## Need To File A Bug

Use `/validator-issue` from an agent session. It collects config, debug-log excerpts, and execution state before drafting the issue.
