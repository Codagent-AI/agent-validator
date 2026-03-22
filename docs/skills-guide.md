# Skills Guide

Agent Gauntlet installs **skills** that let you invoke gauntlet workflows directly from your AI agent session.

## Available Skills

| Skill | Invocation | Description |
|-------|-----------|-------------|
| Setup | `/gauntlet-setup` | Scan project and configure checks and reviews |
| Run | `/gauntlet-run` | Run the full verification suite (checks + reviews) |
| Check | `/gauntlet-check` | Run checks only (no AI reviews) |
| Skip | `/gauntlet-skip` | Advance execution state baseline without running gates |
| Status | `/gauntlet-status` | Show a summary of the most recent gauntlet session |
| Help | `/gauntlet-help` | Diagnose and explain gauntlet behavior (diagnosis-only) |
| Commit | `/gauntlet-commit` | Gate a commit behind optional validation (detect → validate → commit) |
| Merge | `/gauntlet-merge <branch>` | Merge a branch and propagate its validated execution state |
| Issue | `/gauntlet-issue` | Collect diagnostic evidence and file a GitHub bug report |

## Installation

### Claude Code (Plugin Delivery)

For Claude Code, skills and hooks are delivered as part of the **agent-gauntlet Claude Code plugin**. When you run `agent-gauntlet init` with Claude selected, it registers the marketplace and installs the plugin via:

```bash
claude plugin marketplace add pcaplan/agent-gauntlet
claude plugin install agent-gauntlet --scope <project|user>
```

The plugin bundles skills in `.claude/skills/` and hooks in `hooks/hooks.json`. No manual file management is needed — updates are delivered via `agent-gauntlet update`, or manually with `claude plugin marketplace update agent-gauntlet` followed by `claude plugin update agent-gauntlet@pcaplan/agent-gauntlet`.

### Cursor (Plugin Delivery)

For Cursor, skills and hooks are delivered as part of the **agent-gauntlet Cursor plugin**. When you run `agent-gauntlet init` with Cursor selected, it copies plugin files to `.cursor/plugins/agent-gauntlet/` (project scope) or `~/.cursor/plugins/agent-gauntlet/` (user scope).

The plugin bundles skills in `skills/` and hooks in `hooks/hooks.json`.

### Codex (File Copy)

For Codex, skills are copied to `.agents/skills/` (local scope) or `$HOME/.agents/skills/` (global scope) during init. Installation uses **checksum-based comparison**:

- **Missing skills** are created silently
- **Unchanged skills** (checksum matches) are skipped silently
- **Changed skills** (checksum differs) prompt for confirmation before overwriting

With `--yes`, changed files are overwritten without prompting.

### Skill File Structure

Skills are directory-based `SKILL.md` files:

```text
.claude/skills/
  gauntlet-setup/SKILL.md
  gauntlet-setup/references/
    check-catalog.md
    project-structure.md
  gauntlet-run/SKILL.md
  gauntlet-check/SKILL.md
  gauntlet-status/SKILL.md
  gauntlet-help/SKILL.md
  gauntlet-help/references/
    config-troubleshooting.md
    gate-troubleshooting.md
    lock-troubleshooting.md
    adapter-troubleshooting.md
```

For **non-native CLI agents** (Gemini, etc.), `init` prints `@file_path` references so you can point your agent at the skill files directly (e.g., `@.claude/skills/gauntlet-run/SKILL.md`).

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

### /gauntlet-check

Same iterative workflow as `/gauntlet-run` but skips AI reviews. Useful for quickly validating that linting, tests, and other deterministic checks pass.

### /gauntlet-status

Runs a bundled script that parses `gauntlet_logs/` to show a structured summary of the most recent session: which gates ran, what passed/failed, and any outstanding violations.

### /gauntlet-help

Diagnose and explain gauntlet behavior from runtime evidence. This is a **diagnosis-only** skill — it investigates what happened and why, but does not auto-fix issues. It works without source code access, using only config files, logs, and CLI commands.

The skill follows a structured diagnostic workflow:
1. Resolves `log_dir` from `.gauntlet/config.yml`
2. Reads passive evidence (logs, execution state, config)
3. Runs CLI commands only when needed (`agent-gauntlet list`, `health`, `detect`)
4. Returns a structured response with **Diagnosis**, **Evidence**, **Confidence**, and **Next Steps**

Reference files under `references/` provide detailed troubleshooting guidance organized by domain: config, gates, locks, and adapters.

After diagnosis, the skill applies confidence-based bug-filing routing:
- **High confidence + bug**: automatically invokes `/gauntlet-issue`
- **Medium confidence + possible bug**: asks "Want me to file a GitHub issue?"
- **Low confidence**: no action

### /gauntlet-commit

Gate a commit behind optional gauntlet validation.

**Workflow:**
1. Runs `agent-gauntlet detect` — if no changes found, commits immediately (no validation)
2. Parses inline intent from arguments: "run"/"full" → `/gauntlet-run`; "check"/"checks" → `/gauntlet-check`; "skip" → `agent-gauntlet skip`; unclear → prompts user to choose
3. Runs the chosen validation skill; if it fails, asks "Ready to commit?" before proceeding
4. Commits using an available commit skill if found, otherwise stages and commits directly

**Usage:** `/gauntlet-commit` or `/gauntlet-commit run` / `/gauntlet-commit checks` / `/gauntlet-commit skip`

### /gauntlet-merge

Merge a branch and propagate its validated execution state, eliminating redundant re-validation.

**Workflow:**
1. Locates the worktree (or main clone) where `<branch>` is checked out via `git worktree list`
2. Reads `log_dir` from each worktree's `.gauntlet/config.yml` (default: `gauntlet_logs`)
3. Verifies the source `.execution_state` exists before merging (fails fast if missing)
4. Runs `git merge <branch>`
5. Copies `.execution_state` from the source worktree to the current directory

The branch must be checked out in some worktree — if it was deleted after merging, the execution state is gone and the skill reports an error.

**Usage:** `/gauntlet-merge <branch-name>`

### /gauntlet-issue

Collect runtime diagnostic evidence and file a structured GitHub issue on `Codagent-AI/agent-validator`. Requires the `gh` CLI.

**Workflow:**
1. Reads bug description from arguments (or prompts if empty)
2. Collects evidence: last 50 lines of `.debug.log`, full `.execution_state`, `.gauntlet/config.yml` — notes absent files
3. Drafts a structured issue (Problem, Steps to Reproduce, Expected vs Actual, Evidence) with redaction guidance for sensitive values
4. Shows full preview and asks for confirmation (unless invoked with `--auto-file`)
5. Files via `gh issue create --repo Codagent-AI/agent-validator`

**Usage:** `/gauntlet-issue` or `/gauntlet-issue <description of the bug>`

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

## Updating Skills

To update skills after upgrading Agent Gauntlet:

```bash
agent-gauntlet update
```

For Claude Code, this updates the plugin via marketplace. For Cursor, it re-copies plugin assets from the npm package. For Codex, it refreshes skill files using checksum comparison. You can also re-run `agent-gauntlet init` which delegates to the update flow when `.gauntlet/` already exists.
