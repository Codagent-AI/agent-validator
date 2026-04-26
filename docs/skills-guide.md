# Skills Guide

Agent Validator installs **skills** that let you invoke Agent Validator workflows directly from your AI agent session.

## Available Skills

| Skill | Invocation | Description |
|-------|-----------|-------------|
| Setup | `/validator-setup` | Scan project and configure checks and reviews |
| Run | `/validator-run` | Run the full verification suite (checks + reviews) |
| Check | `/validator-check` | Run checks only (no AI reviews) |
| Skip | `/validator-skip` | Advance execution state baseline without running gates |
| Status | `/validator-status` | Show a summary of the most recent Agent Validator session |
| Help | `/validator-help` | Diagnose and explain Agent Validator behavior (diagnosis-only) |
| Commit | `/validator-commit` | Gate a commit behind optional validation (detect → validate → commit) |
| Issue | `/validator-issue` | Collect diagnostic evidence and file a GitHub bug report |

## Installation

### Claude Code (Plugin Delivery)

For Claude Code, skills and hooks are delivered as part of the **agent-validator Claude Code plugin**. When you run `agent-validator init` with Claude selected, it registers the marketplace and installs the plugin via:

```bash
claude plugin marketplace add Codagent-AI/agent-validator
claude plugin install agent-validator --scope <project|user>
```

The plugin bundles skills in `.claude/skills/` and hooks in `hooks/hooks.json`. No manual file management is needed — updates are delivered via `agent-validator update`, or manually with `claude plugin marketplace update agent-validator` followed by `claude plugin update agent-validator@Codagent-AI/agent-validator`.

### Cursor (Plugin Delivery)

For Cursor, skills and hooks are delivered as part of the **agent-validator Cursor plugin**. When you run `agent-validator init` with Cursor selected, it copies plugin files to `.cursor/plugins/agent-validator/` (project scope) or `~/.cursor/plugins/agent-validator/` (user scope).

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
  validator-setup/SKILL.md
  validator-setup/references/
    check-catalog.md
    project-structure.md
  validator-run/SKILL.md
  validator-check/SKILL.md
  validator-status/SKILL.md
  validator-help/SKILL.md
  validator-help/references/
    config-troubleshooting.md
    gate-troubleshooting.md
    lock-troubleshooting.md
    adapter-troubleshooting.md
```

For **non-native CLI agents** (Gemini, etc.), `init` prints `@file_path` references so you can point your agent at the skill files directly (e.g., `@.claude/skills/validator-run/SKILL.md`).

## Usage

### /validator-setup

Scans the project and configures checks and reviews. This is a multi-file skill (`SKILL.md` + `references/check-catalog.md`).

**Workflow:**
1. Reads `.validator/config.yml` to check current state
2. If `entry_points` is empty (fresh setup): scans the project for tooling signals across 6 categories (build, lint, typecheck, test, security-deps, security-code)
3. If `entry_points` is populated (existing setup): offers options to add checks, add custom gates, or reconfigure
4. Presents discovered checks and asks for confirmation
5. Creates check YAML files and updates `entry_points` in `config.yml`
6. Validates the configuration with `agent-validator validate`

Run this skill after `agent-validator init` to complete your setup.

### /validator-run

The primary skill. Runs the full Agent Validator (checks + reviews) and iterates on failures.

**Workflow:**
1. Archives previous logs (`agent-validator clean` with configurable rotation depth)
2. Runs `agent-validator run`
3. If failures: reads log/JSON output, fixes issues, re-runs
4. Repeats until all gates pass, warnings only remain, or retry limit is reached (logs auto-archived)
5. Provides a session summary

### /validator-check

Same iterative workflow as `/validator-run` but skips AI reviews. Useful for quickly validating that linting, tests, and other deterministic checks pass.

### /validator-status

Runs a bundled script that parses `validator_logs/` to show a structured summary of the most recent session: which gates ran, what passed/failed, and any outstanding violations.

### /validator-help

Diagnose and explain Agent Validator behavior from runtime evidence. This is a **diagnosis-only** skill — it investigates what happened and why, but does not auto-fix issues. It works without source code access, using only config files, logs, and CLI commands.

The skill follows a structured diagnostic workflow:
1. Resolves `log_dir` from `.validator/config.yml`
2. Reads passive evidence (logs, execution state, config)
3. Runs CLI commands only when needed (`agent-validator list`, `health`, `detect`)
4. Returns a structured response with **Diagnosis**, **Evidence**, **Confidence**, and **Next Steps**

Reference files under `references/` provide detailed troubleshooting guidance organized by domain: config, gates, locks, and adapters.

After diagnosis, the skill applies confidence-based bug-filing routing:
- **High confidence + bug**: automatically invokes `/validator-issue`
- **Medium confidence + possible bug**: asks "Want me to file a GitHub issue?"
- **Low confidence**: no action

### /validator-commit

Gate a commit behind optional Agent Validator validation.

**Workflow:**
1. Runs `agent-validator detect` — if no changes found, commits immediately (no validation)
2. Parses inline intent from arguments: "run"/"full" → `/validator-run`; "check"/"checks" → `/validator-check`; "skip" → `agent-validator skip`; unclear → prompts user to choose
3. Runs the chosen validation skill; if it fails, asks "Ready to commit?" before proceeding
4. Commits using an available commit skill if found, otherwise stages and commits directly

**Usage:** `/validator-commit` or `/validator-commit run` / `/validator-commit checks` / `/validator-commit skip`

### /validator-issue

Collect runtime diagnostic evidence and file a structured GitHub issue on `Codagent-AI/agent-validator`. Requires the `gh` CLI.

**Workflow:**
1. Reads bug description from arguments (or prompts if empty)
2. Collects evidence: last 50 lines of `.debug.log`, full `.execution_state`, `.validator/config.yml` — notes absent files
3. Drafts a structured issue (Problem, Steps to Reproduce, Expected vs Actual, Evidence) with redaction guidance for sensitive values
4. Shows full preview and asks for confirmation (unless invoked with `--auto-file`)
5. Files via `gh issue create --repo Codagent-AI/agent-validator`

**Usage:** `/validator-issue` or `/validator-issue <description of the bug>`

## Customization

Skills are plain Markdown files with YAML frontmatter. You can edit them directly:

```yaml
---
name: validator-run
description: Run the full verification Agent Validator
disable-model-invocation: true
allowed-tools: Bash
---
```

- `disable-model-invocation: true` prevents Claude from automatically loading and invoking the skill. The user can still invoke it via `/name`. Use this for workflows with side effects (the default for Agent Validator skills).
- `user-invocable: false` hides the skill from the `/` autocomplete menu entirely.
- `allowed-tools` restricts which tools the agent can use during execution

## Updating Skills

To update skills after upgrading Agent Validator:

```bash
agent-validator update
```

For Claude Code, this updates the plugin via marketplace. For Cursor, it re-copies plugin assets from the npm package. For Codex, it refreshes skill files using checksum comparison. You can also re-run `agent-validator init` which delegates to the update flow when `.validator/` already exists.
