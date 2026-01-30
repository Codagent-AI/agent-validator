# User Guide

Agent Gauntlet runs **quality gates** (checks + AI reviews) for **only the parts of your repo that changed**, based on a configurable set of **entry points**.

## Core Concepts

Agent Gauntlet is a feedback runner designed to provide comprehensive validation feedback. This feedback comes in two primary forms: Checks and Reviews.

![Agent Gauntlet Core Concepts](images/core_concepts.png)

### Forms of Feedback

#### Checks
Checks are deterministic validations executed via shell commands.
- **Outcome**: They result in a binary `pass` or `fail` status. (Future support for "warnings" is planned).
- **Examples**: Building, linting, testing, or any static analysis tool validation.

#### Reviews
Reviews are AI-generated assessments running via a CLI tool.
- **Execution**: The user must have a CLI capable of running a prompt (e.g., Claude Code, Codex, etc).
- **Configuration**: The primary configuration for a review is the prompt text itself.

### Configuration Structure

Agent Gauntlet determines what feedback to run based on a configuration file.

#### Entry Points
- **Definition**: An entry point is a path (e.g., project root or a specific subfolder).
- **Scope**: You can define one or more entry points.
- **Assignment**: For each entry point, you specify which Checks and Reviews to execute.
- **Wildcard support**: Use `dir/*` wildcards to match multiple subdirectories.

#### Definitions
Each Check and Review has a definition:
- **Check Definition**: Specifies the shell command to run (`.gauntlet/checks/*.yml`).
- **Review Definition**: Specifies the prompt for the AI to process (`.gauntlet/reviews/*.md`).

### Configuration Examples

Here are simple specific examples of the configuration files described above.

#### Main Configuration (`.gauntlet/config.yml`)

This file maps your project structure to specific checks and reviews.

```yaml
entry_points:
  # Run these validations for any changes in the 'src' directory
  - path: "src"
    checks:
      - build
    reviews:
      - code-review
```

#### Check Definition (`.gauntlet/checks/test.yml`)

A deterministic command that either passes (exit code 0) or fails.

```yaml
# The shell command to execute
command: npm run test

# Optional: Run in parallel with other checks
parallel: true
```

#### Review Definition (`.gauntlet/reviews/code-review.md`)

A prompt that guides the AI agent's review process.

```markdown
---
# Simple frontmatter configuration
cli_preference:
  - claude
  - gemini
---

# Code Review Instructions

You are a helpful code review assistant. Please check the code for:
1. Logic errors
2. Missing error handling

If the code looks good, please reply with "LGTM!" (Looks Good To Me).
```

## Getting started

### 1) Create config skeleton

```bash
agent-gauntlet init
```

This creates:

```text
.gauntlet/
  config.yml
  reviews/
    code-quality.md
```

### 2) Add check gates (optional)

Create YAML files under `.gauntlet/checks/`, e.g. `.gauntlet/checks/lint.yml`:

```yaml
name: lint
command: bun test
working_directory: .
```

### 3) Add review gates (optional)

Create Markdown files under `.gauntlet/reviews/`. The **filename without `.md`** is the gate name.

Example: `.gauntlet/reviews/architecture.md`

```markdown
---
cli_preference:
  - gemini
  - codex
  - claude
  - github-copilot
num_reviews: 1
pass_pattern: "PASS|No issues"
---

# Architecture review

Review the diff for architectural issues. End your response with PASS if all is good.
```

### 4) Wire gates to entry points

Edit `.gauntlet/config.yml` and add `entry_points` that reference your check/review names.

## Commands

### `agent-gauntlet` / `agent-gauntlet help`

Shows help information and available commands. This is the default when no command is provided.

### `agent-gauntlet run`

Runs applicable gates for detected changes.

- Detects changed files via `git` (committed + uncommitted + untracked locally; PR/push diffs in CI)
- Expands entry points that match those changes
- Runs gates for those active entry points

#### `--gate <name>`

Filters to a single gate name (check or review). If multiple entry points would run the same gate, it runs for each matching entry point.

#### `--commit <sha>`

Uses diff for a specific commit instead of the default change detection logic. The diff is computed as `commit^..commit`.

#### `--uncommitted`

Uses diff for current uncommitted changes only (both staged and unstaged, plus untracked files). Ignores committed changes. Git-ignored files (via `.gitignore` or other git exclude files) are excluded from untracked file detection.

### `agent-gauntlet check`

Runs only applicable checks for detected changes. Reviews are skipped.

- Detects changed files via `git` (committed + uncommitted + untracked locally; PR/push diffs in CI)
- Expands entry points that match those changes
- Runs only check gates for those active entry points

Uses the same options as `run` (see above). When using `--gate <name>`, filters to a single check gate name.

### `agent-gauntlet review`

Runs only applicable reviews for detected changes. Checks are skipped.

- Detects changed files via `git` (committed + uncommitted + untracked locally; PR/push diffs in CI)
- Expands entry points that match those changes
- Runs only review gates for those active entry points

Uses the same options as `run` (see above). When using `--gate <name>`, filters to a single review gate name.

### `agent-gauntlet clean`

Archives logs by moving current `.log` files into `previous/` (after clearing old `previous/` contents).

This is also triggered automatically when a run completes with all gates passing.

### Automatic verification mode

When `run`, `check`, or `review` detect existing `.log` files in the log directory, they automatically switch to verification mode:

- Uses uncommitted changes as the diff source (instead of comparing against `base_branch`)
- Parses the highest-numbered log per prefix for previous failures
- Injects those failures as context for review gates

This replaces the old `rerun` command — simply run `agent-gauntlet run` again after making fixes.

### `agent-gauntlet detect`

Shows what gates would run for detected changes without actually executing them.

- Detects changed files using the same logic as `run`
- Expands entry points that match those changes
- Lists all gates that would run, grouped by entry point

#### `--commit <sha>`

Uses diff for a specific commit instead of the default change detection logic.

#### `--uncommitted`

Uses diff for current uncommitted changes only (both staged and unstaged, plus untracked files). Git-ignored files (via `.gitignore` or other git exclude files) are excluded from untracked file detection.

### `agent-gauntlet list`

Prints:
- Loaded check gate names (from `.gauntlet/checks/*.yml`)
- Loaded review gate names (from `.gauntlet/reviews/*.md`)
- Configured entry points (from `.gauntlet/config.yml`)

### `agent-gauntlet health`

Checks availability of supported review CLIs (`gemini`, `codex`, `claude`, `github-copilot`).

### `agent-gauntlet init`

Creates `.gauntlet/` with a minimal starter config and a sample review prompt.

```text
.gauntlet/
  config.yml           # Entry points and settings
  run_gauntlet.md      # Canonical /gauntlet command for CLI agents
  checks/              # Check gate definitions
  reviews/
    code-quality.md    # Sample review prompt
```

#### Interactive prompts

When run interactively, `init` prompts you to set up CLI agent commands:

1. **Installation level**: Choose where to install the `/gauntlet` command:
   - Don't install commands
   - Project level (`.claude/commands/`, `.gemini/commands/`)
   - User level (`~/.claude/commands/`, `~/.gemini/commands/`, `~/.codex/prompts/`)

2. **Agent selection**: Choose which CLI agents to install for (Claude, Gemini, Codex, or all)

Once installed, you can run `/gauntlet` directly in your CLI agent session to execute the verification suite.

#### Options

- `-y, --yes`: Skip prompts and use defaults (project-level commands for all supported agents)

### `agent-gauntlet ci`

Commands for integrating Agent Gauntlet with CI/CD systems (GitHub Actions).

#### `agent-gauntlet ci init`

Generates a dynamic GitHub Actions workflow (`.github/workflows/gauntlet.yml`) and a starter CI configuration (`.gauntlet/ci.yml`).

- The generated workflow uses a "discover" job to dynamically build the job matrix based on changed files and configured checks.
- You generally only need to run this once, or when you add new service dependencies (e.g. Postgres, Redis) to `.gauntlet/ci.yml`.

#### `agent-gauntlet ci list-jobs`

Internal command used by the CI workflow to discover which jobs to run.

- Reads `.gauntlet/ci.yml` and `.gauntlet/config.yml`
- Expands entry points based on file patterns
- Outputs a JSON object defining the job matrix and service configurations

### `agent-gauntlet help`

Shows help information, including an overview of Agent Gauntlet and all available commands. This is the default command when no command is provided.

## Change detection

Agent Gauntlet uses `git` to find changed file paths.

### Local runs

Includes:
- Committed changes vs `base_branch` (default: `origin/main`)
- Uncommitted changes (staged + unstaged)
- Untracked files

### CI runs

CI mode is detected when either:
- `CI=true`, or
- `GITHUB_ACTIONS=true`

In CI, it diffs:
- `GITHUB_BASE_REF...GITHUB_SHA` when available
- otherwise falls back to `HEAD^...HEAD`

## Entry points

Entry points are configured in `.gauntlet/config.yml` under `entry_points`.

### Root entry point (`.`)

If there are any changed files at all, Agent Gauntlet always includes a root entry point (`.`).

- If you configured an explicit `- path: "."`, those gates will run on **any change anywhere**.
- If you did not, the root entry point still exists internally, but it will have no gates and therefore does nothing.

### Fixed directory entry point

Example:

```yaml
entry_points:
  - path: apps/api
    checks: [lint]
```

This activates if any changed file:
- is exactly `apps/api`, or
- is under `apps/api/…`

### Wildcard entry point (`dir/*`)

Example:

```yaml
entry_points:
  - path: packages/*
    checks: [lint]
```

If changes are in:
- `packages/ui/...`
- `packages/utils/...`

Then this expands to two entry points:
- `packages/ui`
- `packages/utils`

Notes:
- This wildcard expansion is based on changed paths (it doesn’t scan the filesystem).
- Only a trailing `*` of the form `parent/*` is supported.

## Project config (`.gauntlet/config.yml`)

### `base_branch` (string, default: `origin/main`)

The branch/ref to diff against in local runs.

### `log_dir` (string, default: `gauntlet_logs`)

Directory where job logs are written.

### `cli` (object, required)

- `default_preference`: string[] (required) - Default list of CLI tools to use for reviews.
- `check_usage_limit`: boolean (default: `false`) - Whether to check for usage limits during health checks.

### `allow_parallel` (boolean, default: `true`)

Controls scheduling mode:
- `true`: gates with `parallel: true` run concurrently; `parallel: false` run sequentially (but concurrently with the parallel batch)
- `false`: all gates run sequentially

### `max_retries` (number, default: `3`)

Maximum number of retry attempts. After the initial run, the system allows up to this many additional runs.

### `rerun_new_issue_threshold` (number, default: `3`)

Maximum new issues allowed in a rerun before failing.

### `debug_log` (object, optional)

Configuration for persistent debug logging:
- `enabled` (boolean, default: `false`): Whether to enable debug logging
- `max_size_mb` (number, default: `10`): Maximum log file size before rotation

### `entry_points` (array, required)

Each entry point:

```yaml
- path: "..."
  checks: ["checkName", ...]   # optional
  reviews: ["reviewName", ...] # optional
```

## Check gates (`.gauntlet/checks/*.yml`)

Each file is parsed as a check gate definition. The gate is keyed by its `name`.

Fields:

- `name` (string, required): Unique gate name
- `command` (string, required): Shell command to run
- `working_directory` (string, optional): Defaults to the entry point path
- `parallel` (boolean, default: `false`)
- `run_in_ci` (boolean, default: `true`)
- `run_locally` (boolean, default: `true`)
- `timeout` (number seconds, optional)
- `fail_fast` (boolean, optional): If `true`, stops running other checks or reviews after this check fails. Can only be used when `parallel` is `false`.

Behavior:
- Passes when the command exits `0`
- Fails when it exits non-zero
- Fails on timeout (if `timeout` is set)

## Review gates (`.gauntlet/reviews/*.md`)

Review gates are defined by Markdown files with YAML frontmatter.

- The gate name is the filename without `.md` (e.g. `security.md` → `security`)
- The prompt body is the Markdown content after the frontmatter

### Frontmatter fields

- `cli_preference` (string[], optional): ordered list of tools. If omitted, uses `cli.default_preference` from project config.
- `num_reviews` (number, default: `1`): number of tools to run (chooses the first N available from `cli_preference`)
- `model` (string, optional): passed through to adapters that support it
- `parallel` (boolean, default: `true`)
- `run_in_ci` (boolean, default: `true`)
- `run_locally` (boolean, default: `true`)
- `timeout` (number seconds, optional)

### Pass/fail detection

Tool output is evaluated using regexes:

- `pass_pattern` (string regex, default: `PASS|No issues|No violations|None found`)
- `fail_pattern` (string regex, optional)
- `ignore_pattern` (string regex, optional)

Rules:
- If `fail_pattern` matches:
  - If `ignore_pattern` also matches → **pass**
  - Else → **fail**
- Else, if `pass_pattern` does not match → **fail**
- Else → **pass**

When `num_reviews > 1`:
- Each tool is evaluated independently
- If **any** tool fails → the review gate fails

### Diff content

For each active entry point, the review receives a `git diff` scoped to the entry point path.

The agent is also granted read-only access to the repository to dynamically fetch additional context if needed.

## Logs

Each job writes a log file under `log_dir` (default: `gauntlet_logs/`), including:
- the command/tool used
- full stdout/stderr (checks)
- review output per tool (reviews)
- final pass/fail/error decision

### Debug logging

When `debug_log.enabled` is `true`, Agent Gauntlet writes detailed execution logs to `.debug.log` in the log directory. This includes:
- Command invocations with arguments
- Run start/end events with timing
- Gate results (pass/fail/error)
- Clean operations (manual/auto with reason)
- Stop hook decisions

The debug log survives `clean` operations and rotates when it exceeds `max_size_mb`.

### Persistent files

The following files in the log directory survive `clean` operations:
- `.execution_state` - Tracks branch, commit, and working tree state
- `.debug.log` - Debug log (when enabled)
- `.debug.log.1` - Rotated debug log

## Troubleshooting

- **“Configuration file not found”**: ensure `.gauntlet/config.yml` exists (or run `agent-gauntlet init`).
- **No gates run**: either no changes were detected, or no entry point matched those changes, or the matching entry point has no gates.
- **Check gate shows “Missing command” in preflight**: the first token of `command` must resolve on `PATH` (or be an executable path).
- **Review gate shows "Missing CLI tools"**: install one of the requested tools (`gemini`, `codex`, `claude`, `github-copilot`) and ensure it's on `PATH`.
