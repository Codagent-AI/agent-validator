---
title: Skills Guide
group: Reference
order: 6
description: Agent-facing validator skill behavior.
---

# Skills Guide

Agent Validator ships skills that let coding agents run validation, diagnose failures, update review decisions, and commit with explicit validator involvement.

## Available Skills

| Skill | Use when |
| --- | --- |
| `/validator-setup` | Setting up or reconfiguring project gates |
| `/validator-run` | Running full validation: checks and reviews |
| `/validator-check` | Running checks only, without AI reviews |
| `/validator-status` | Summarizing the latest validator session |
| `/validator-help` | Explaining validator behavior from logs and state |
| `/validator-commit` | Committing with explicit validator validation intent |
| `/validator-issue` | Filing a structured agent-validator bug report |
| `/validator-skip` | Advancing the baseline without gates after explicit confirmation |

## Installation

Run:

```bash
agent-validate init
```

Init delegates integration installation to `agent-plugin`. Depending on the selected agents and scope, skills are delivered through plugins or copied to agent skill directories.

To preselect development agents:

```bash
agent-validate init --agents claude codex
```

To refresh installed skills and plugins:

```bash
agent-validate update
```

## `/validator-setup`

Scans the project and edits `.validator/config.yml`.

It:

- confirms `.validator/config.yml` exists
- distinguishes fresh setup from existing configuration
- detects project structure
- discovers build, lint, typecheck, test, and static analysis commands
- writes inline checks under `entry_points`
- preserves existing review entries unless reconfiguration is requested
- runs `agent-validate validate`

## `/validator-run`

Runs `agent-validate run`, extracts failures from logs, fixes issues, updates review decisions, and reruns until the validator reaches a terminal status.

Use it for full validation requests such as "run the validator" or "validate before PR".

## `/validator-check`

Runs `agent-validate check` and follows the same failure extraction and rerun protocol, but excludes AI reviews.

Use it only when the user explicitly asks for checks-only validation.

## `/validator-status`

Runs `agent-validate status`, then reads relevant log files for failed gates and summarizes the most recent validator session.

## `/validator-help`

Diagnoses validator behavior from runtime evidence:

- `.validator/config.yml`
- `<log_dir>/.debug.log`
- `<log_dir>/.execution_state`
- console logs
- check logs
- review JSON files

It can run diagnostic commands such as `agent-validate list`, `agent-validate health`, and `agent-validate detect` when passive evidence is insufficient.

## `/validator-commit`

Runs `agent-validate detect` first, then chooses validation based on explicit user intent:

| User intent | Action |
| --- | --- |
| run, full, all gates | Invoke `/validator-run` |
| check, checks | Invoke `/validator-check` |
| skip | Run `agent-validate skip` |
| unclear | Ask the user to choose |

Plain commit requests do not select this skill unless they mention validator, gauntlet, checks, validation, or skip behavior.

## `/validator-issue`

Collects runtime evidence, drafts a GitHub issue, previews it, and files it only after confirmation unless invoked in auto-file mode.

## `/validator-skip`

Runs `agent-validate skip` only after explicit confirmation. The exact phrase `skip validator` in the user request counts as confirmation.

## Customization

Installed skills may be adapted after installation, but the packaged source of truth is the repository `skills/` directory.
