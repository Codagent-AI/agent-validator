# Skills Guide

Agent Gauntlet installs **skills** (for Claude Code) and **flat commands** (for other CLI agents) that let you invoke gauntlet workflows directly from your AI agent session.

## Available Skills

| Skill | Invocation | Description |
|-------|-----------|-------------|
| Setup | `/gauntlet-setup` | Scan project and configure checks and reviews |
| Run | `/gauntlet-run` | Run the full verification suite (checks + reviews) |
| Check | `/gauntlet-check` | Run checks only (no AI reviews) |
| Push PR | `/gauntlet-push-pr` | Commit, push, and create/update a pull request |
| Fix PR | `/gauntlet-fix-pr` | Address review comments and fix CI failures |
| Status | `/gauntlet-status` | Show a summary of the most recent gauntlet session |
| Help | `/gauntlet-help` | Diagnose and explain gauntlet behavior (diagnosis-only) |

## Installation

Skills are installed during `agent-gauntlet init` (Phase 5) into the project's `.claude/skills/` directory. Installation uses **checksum-based comparison**:

- **Missing skills** are created silently
- **Unchanged skills** (checksum matches) are skipped silently
- **Changed skills** (checksum differs) prompt for confirmation before overwriting

With `--yes`, changed files are overwritten without prompting.

Skills are installed as directory-based `SKILL.md` files:

```text
.claude/skills/
  gauntlet-setup/SKILL.md
  gauntlet-setup/references/
    check-catalog.md
    project-structure.md
  gauntlet-run/SKILL.md
  gauntlet-check/SKILL.md
  gauntlet-push-pr/SKILL.md
  gauntlet-fix-pr/SKILL.md
  gauntlet-status/SKILL.md
  gauntlet-help/SKILL.md
  gauntlet-help/references/
    stop-hook-troubleshooting.md
    config-troubleshooting.md
    gate-troubleshooting.md
    lock-troubleshooting.md
    adapter-troubleshooting.md
    ci-pr-troubleshooting.md
```

For **non-native CLI agents** (Codex, Gemini, etc.), Phase 6 of `init` prints `@file_path` references so you can point your agent at the skill files directly (e.g., `@.claude/skills/gauntlet-run/SKILL.md`).

## Usage

### /gauntlet-setup

Scans the project and configures checks and reviews. This is a multi-file skill (`SKILL.md` + `references/check-catalog.md`).

**Workflow:**
1. Reads `.gauntlet/config.yml` to check current state
2. If `entry_points` is empty (fresh setup): scans the project for tooling signals across 6 categories (build, lint, typecheck, test, security-deps, security-code)
3. If `entry_points` is populated (existing setup): offers options to add checks, add custom gates, or reconfigure
4. Presents discovered checks and asks for confirmation
5. Creates check YAML files and updates `entry_points` in `config.yml`
6. Validates the configuration with `agent-gauntlet validate`

Run this skill after `agent-gauntlet init` to complete your setup.

### /gauntlet-run

The primary skill. Runs the full gauntlet (checks + reviews) and iterates on failures.

**Workflow:**
1. Archives previous logs (`agent-gauntlet clean` with configurable rotation depth)
2. Runs `agent-gauntlet run`
3. If failures: reads log/JSON output, fixes issues, re-runs
4. Repeats until all gates pass, warnings only remain, or retry limit is reached (logs auto-archived)
5. Provides a session summary

**Trust level:** The run skill includes a configurable trust level (default: `medium`) that controls how aggressively the agent acts on AI reviewer feedback. Edit the `<!-- trust_level: medium -->` comment in the SKILL.md to change it:

| Level | Behavior |
|-------|----------|
| `high` | Fix all issues unless you strongly disagree |
| `medium` | Fix issues you reasonably agree with (default) |
| `low` | Fix only issues you strongly agree with |

### /gauntlet-check

Same iterative workflow as `/gauntlet-run` but skips AI reviews. Useful for quickly validating that linting, tests, and other deterministic checks pass.

### /gauntlet-push-pr

Commits all changes, pushes to the remote, and creates or updates a pull request. Verifies the PR exists after creation.

### /gauntlet-fix-pr

Checks CI status and review comments on the current PR, fixes issues, commits, and pushes.

### /gauntlet-status

Runs a bundled script that parses `gauntlet_logs/` to show a structured summary of the most recent session: which gates ran, what passed/failed, and any outstanding violations.

### /gauntlet-help

Diagnose and explain gauntlet behavior from runtime evidence. This is a **diagnosis-only** skill — it investigates what happened and why, but does not auto-fix issues. It works without source code access, using only config files, logs, and CLI commands.

The skill follows a structured diagnostic workflow:
1. Resolves `log_dir` from `.gauntlet/config.yml`
2. Reads passive evidence (logs, execution state, config)
3. Runs CLI commands only when needed (`agent-gauntlet list`, `health`, `detect`)
4. Returns a structured response with **Diagnosis**, **Evidence**, **Confidence**, and **Next Steps**

Reference files under `references/` provide detailed troubleshooting guidance organized by domain: stop-hook, config, gates, locks, adapters, and CI/PR.

## Customization

Skills are plain Markdown files with YAML frontmatter. You can edit them directly:

```yaml
---
name: gauntlet-run
description: Run the full verification gauntlet
disable-model-invocation: true
allowed-tools: Bash
---
```

- `disable-model-invocation: true` prevents Claude from automatically loading and invoking the skill. The user can still invoke it via `/name`. Use this for workflows with side effects (the default for gauntlet skills).
- `user-invocable: false` hides the skill from the `/` autocomplete menu entirely.
- `allowed-tools` restricts which tools the agent can use during execution

## Re-installing Skills

To update skills after upgrading Agent Gauntlet, re-run `agent-gauntlet init`. The checksum-based comparison detects changed skills and prompts you to update them. Use `--yes` to overwrite all changed skills without prompting.
