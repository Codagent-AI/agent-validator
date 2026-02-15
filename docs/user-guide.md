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

### 1) Run interactive setup

```bash
agent-gauntlet init
```

This walks you through a guided setup:

1. **Detects available CLIs** on your system
2. **Prompts for development CLIs** — the tools you work in (hooks are installed for CLIs that support them)
3. **Prompts for review CLIs** — the tools used for AI code reviews (populates `cli.default_preference`)
4. **Creates `.gauntlet/`** (skipped if it already exists):

```text
.gauntlet/
  config.yml              # entry_points: [] (empty)
  reviews/
    code-quality.yml      # built-in code-quality review
```

5. **Installs skills and hooks** — always runs, even on re-init. Uses checksums to skip unchanged files and prompt before overwriting changed ones.
6. **Prints next steps** — context-aware instructions based on your selected CLIs

### 2) Configure checks and reviews

Run the `/gauntlet-setup` skill in your AI agent session:

```text
/gauntlet-setup
```

The setup skill scans your project, discovers available tooling (linters, test runners, type checkers, etc.), and configures checks and entry points in `.gauntlet/config.yml`. See the [Skills Guide](skills-guide.md) for details.

### 3) Add additional gates (optional)

You can manually add check or review gates at any time, or re-run `/gauntlet-setup` to add more.

**Check gate example** (`.gauntlet/checks/lint.yml`):

```yaml
command: npx eslint .
working_directory: .
```

**Review gate example** (`.gauntlet/reviews/architecture.md`):

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

Edit `.gauntlet/config.yml` and add `entry_points` that reference your check/review names (or let `/gauntlet-setup` handle this).

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

Archives logs using configurable N-deep rotation. Current `.log` and `.json` files are moved into `previous/`, while existing `previous/` archives shift to `previous.1/`, `previous.2/`, etc. The oldest archive beyond `max_previous_logs` (default: 3) is evicted. Execution state is preserved.

This is also triggered automatically when a run completes with all gates passing, or when the retry limit is exceeded.

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

Guided interactive setup that creates `.gauntlet/`, installs skills, and configures hooks.

```text
.gauntlet/
  config.yml              # Entry points and settings (entry_points starts empty)
  checks/                 # Check gate definitions (populated by /gauntlet-setup)
  reviews/
    code-quality.yml      # Built-in code-quality review (num_reviews: 1)
```

The `init` command walks you through the following steps:

1. **CLI Detection**: Discovers available CLIs on the system
2. **Development CLI Selection**: Multi-select prompt for your development tools. Hooks are installed for CLIs that support them (Claude Code, Cursor). CLIs without hook support display a warning.
3. **Review CLI Selection**: Multi-select prompt for review tools. Populates `cli.default_preference` in the user's selection order. If one review CLI is selected, `num_reviews` is set to 1 automatically. If multiple are selected, you're prompted for how many to run per review.
4. **Scaffold `.gauntlet/`**: Creates the directory, config skeleton (`entry_points: []`), and built-in code-quality review. **Skipped entirely** if `.gauntlet/` already exists (config is never overwritten).
5. **Install External Files**: Installs skills to `.claude/skills/` and hooks for development CLIs. **Always runs**, even on re-init. Uses SHA-256 checksums to: create missing files silently, skip unchanged files, and prompt before overwriting changed files.
6. **Post-Init Instructions**: Prints context-aware next steps. Native CLIs (Claude Code, Cursor) get `/gauntlet-setup` instructions. Non-native CLIs get `@file_path` skill references with descriptions.

After `init`, run `/gauntlet-setup` in your AI agent session to scan the project, discover tooling, and configure checks and entry points. See the [Skills Guide](skills-guide.md) for details.

#### Options

- `-y, --yes`: Skip all interactive prompts. Selects all detected CLIs as both development and review CLIs, sets `num_reviews` to the detected count, and overwrites changed files without asking.

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

### `agent-gauntlet wait-ci`

Waits for CI checks to complete and checks for blocking reviews on the current PR.

This command is primarily used internally by the stop hook when `auto_fix_pr` is enabled, but can also be run manually to check CI status.

#### Options

- `--timeout <seconds>` (default: `270`): Maximum time to wait for CI checks to complete
- `--poll-interval <seconds>` (default: `15`): Time between CI status checks

#### Output

Returns JSON with:
- `ci_status`: One of `passed`, `failed`, `pending`, or `error`
- `pr_number`: The PR number (if found)
- `pr_url`: The PR URL (if found)
- `failed_checks`: Array of failed check details
- `review_comments`: Array of blocking review comments (REQUEST_CHANGES only)
- `elapsed_seconds`: Time spent waiting
- `error_message`: Error details (if status is `error`)

#### Exit codes

- `0`: All checks passed, no blocking reviews
- `1`: Failed checks, blocking reviews, error, or no PR found
- `2`: Timeout (checks still pending)

#### Requirements

Requires the GitHub CLI (`gh`) to be installed and authenticated.

### `agent-gauntlet help`

Shows help information, including an overview of Agent Gauntlet and all available commands. This is the default command when no command is provided.

### `agent-gauntlet start-hook`

Session start hook that primes AI agents with gauntlet verification instructions at the beginning of a session.

#### Purpose

The start hook automatically injects context into agent sessions to remind them to run `/gauntlet-run` before completing coding tasks. This ensures agents are aware of quality gates from the start of each session.

#### Usage

```bash
agent-gauntlet start-hook [--adapter <adapter>]
```

#### Options

- `--adapter <adapter>` (default: `claude`): Output format for the specific CLI adapter
  - `claude`: Outputs JSON in Claude Code's `SessionStart` hook format
  - `cursor`: Outputs plain text for Cursor IDE

#### Behavior

- Checks for `.gauntlet/config.yml` in the current directory
- If no valid config exists, performs a silent no-op (no output, clean exit)
- If config exists, outputs verification instructions in the appropriate format for the target CLI
- Instructions remind agents to run `/gauntlet-run` before reporting tasks as complete

#### Installation

Start hooks are automatically installed during `agent-gauntlet init` for Claude Code and Cursor when they are among the selected CLIs. No manual configuration is required.

#### Integration

- **Claude Code**: Configured in `.claude/settings.local.json` as a `SessionStart` hook (fires once per session event: startup, resume, clear, compact)
- **Cursor**: Configured in `.cursor/hooks.json` as a `sessionStart` hook

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

For the full schema reference including all fields and their defaults, see [Project config in the Config Reference](config-reference.md#project-config-gauntletconfigyml).

Key configuration sections:
- **base_branch**: The branch/ref to diff against in local runs
- **log_dir**: Directory where job logs are written
- **cli**: CLI tool preferences for reviews
- **entry_points**: Maps paths to their applicable gates
- **stop_hook**: Stop hook behavior for CLI agents (see also [Environment Variable Overrides](config-reference.md#environment-variable-overrides))

### Entry points example

```yaml
- path: "."
  reviews: ["code-quality"]    # runs on any change

- path: "apps/api"
  checks: ["test", "lint"]     # runs when apps/api/** changes
  reviews: ["architecture"]

- path: "packages/*"
  checks: ["lint"]             # expands to one job per changed package
```

## Check gates (`.gauntlet/checks/*.yml`)

Each file is parsed as a check gate definition. The gate is keyed by its `name`.

For the full field reference, see [Check gates in the Config Reference](config-reference.md#check-gates-gaunletchecksyml).

Behavior:
- Passes when the command exits `0`
- Fails when it exits non-zero
- Fails on timeout (if `timeout` is set)

## Review gates (`.gauntlet/reviews/*.md`)

Review gates are defined by Markdown files with YAML frontmatter.

- The gate name is the filename without `.md` (e.g. `security.md` → `security`)
- The prompt body is the Markdown content after the frontmatter

For the full frontmatter schema, see [Review gates in the Config Reference](config-reference.md#review-gates-gauntletreviewsmd-and-gauntletreviewsyml).

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
