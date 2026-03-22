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
agent-validator init
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

### `agent-validator` / `agent-validator help`

Shows help information and available commands. This is the default when no command is provided.

### `agent-validator run`

Runs applicable gates for detected changes.

- Detects changed files via `git` (committed + uncommitted + untracked locally; PR/push diffs in CI)
- Expands entry points that match those changes
- Runs gates for those active entry points

#### `--gate <name>`

Filters to a single gate name (check or review). If multiple entry points would run the same gate, it runs for each matching entry point.

#### `--enable-review <name>` / `-e <name>`

Activates a review that has `enabled: false` in its config for this run. Can be repeated to activate multiple reviews:

```bash
agent-validator run --enable-review task-compliance
agent-validator run --enable-review task-compliance --enable-review security
```

Reviews with `enabled: true` (the default) are unaffected by this flag. If the name doesn't match any configured review, the flag is silently ignored.

#### `--commit <sha>`

Uses diff for a specific commit instead of the default change detection logic. The diff is computed as `commit^..commit`.

#### `--uncommitted`

Uses diff for current uncommitted changes only (both staged and unstaged, plus untracked files). Ignores committed changes. Git-ignored files (via `.gitignore` or other git exclude files) are excluded from untracked file detection.

#### `--report`

Writes a plain-text failure report to stdout (in addition to the normal stderr output). Designed for external orchestrators like [Baton](https://github.com/Codagent-AI/baton) that capture stdout from shell steps.

The report contains:
- A `Status:` line (Passed, Passed with warnings, Failed, etc.)
- **CHECK FAILURES**: gate label, command, working directory, fix instructions, fix skill, log file path. Does not include parsed error output — the consuming agent reads the log file directly.
- **REVIEW VIOLATIONS**: each violation with a stable numeric ID (`#1`, `#2`, ...), priority, gate label, `file:line - issue`, fix suggestion, and JSON file path.

The report is also written to `<log_dir>/report.txt` to ensure availability in environments where stdout may be dropped.

Output is plain text with no ANSI escape codes, consistent with the convention that stdout is reserved for machine-readable output.

```bash
agent-validator run --report --enable-review task-compliance
```

### `agent-validator check`

Runs only applicable checks for detected changes. Reviews are skipped.

- Detects changed files via `git` (committed + uncommitted + untracked locally; PR/push diffs in CI)
- Expands entry points that match those changes
- Runs only check gates for those active entry points

Uses the same options as `run` (see above). When using `--gate <name>`, filters to a single check gate name.

### `agent-validator review`

Runs only applicable reviews for detected changes. Checks are skipped.

- Detects changed files via `git` (committed + uncommitted + untracked locally; PR/push diffs in CI)
- Expands entry points that match those changes
- Runs only review gates for those active entry points

Uses the same options as `run` (see above), including `--enable-review`. When using `--gate <name>`, filters to a single review gate name.

### `agent-validator review-audit`

Parses the debug log and produces a structured audit report of review gate execution for a given date or date range.

```bash
agent-validator review-audit [--date YYYY-MM-DD] [--since YYYY-MM-DD]
```

#### Options

- `--date <YYYY-MM-DD>`: Filter to a single date (default: today's local date)
- `--since <YYYY-MM-DD>`: Include all runs from this date through today

#### Output

Prints five sections:

- **Run Counts** — cross-tab of gate executions: rows = review type, columns = CLI adapter + Total
- **Timing** — average gate duration per cell, plus per-100-diff-lines rate (excluding zero-diff runs)
- **Violations** — average violations per run per cell
- **Token Usage** — input/output/cache token totals and API request counts per adapter
- **Fix / Skip** — gauntlet run outcomes: fixed, skipped, failed violations; prior-pass skips

### `agent-validator clean`

Archives logs using configurable N-deep rotation. Current `.log` and `.json` files are moved into `previous/`, while existing `previous/` archives shift to `previous.1/`, `previous.2/`, etc. The oldest archive beyond `max_previous_logs` (default: 3) is evicted. Execution state is preserved.

This is also triggered automatically when a run completes with all gates passing, or when the retry limit is exceeded.

### Automatic verification mode

When `run`, `check`, or `review` detect existing `.log` files in the log directory, they automatically switch to verification mode:

- Uses uncommitted changes as the diff source (instead of comparing against `base_branch`)
- Parses the highest-numbered log per prefix for previous failures
- Injects those failures as context for review gates

This replaces the old `rerun` command — simply run `agent-validator run` again after making fixes.

### `agent-validator detect`

Shows what gates would run for detected changes without actually executing them.

- Detects changed files using the same logic as `run`
- Expands entry points that match those changes
- Lists all gates that would run, grouped by entry point

#### `--commit <sha>`

Uses diff for a specific commit instead of the default change detection logic.

#### `--uncommitted`

Uses diff for current uncommitted changes only (both staged and unstaged, plus untracked files). Git-ignored files (via `.gitignore` or other git exclude files) are excluded from untracked file detection.

### `agent-validator list`

Prints:
- Loaded check gate names (from `.gauntlet/checks/*.yml`)
- Loaded review gate names (from `.gauntlet/reviews/*.md`)
- Configured entry points (from `.gauntlet/config.yml`)

### `agent-validator health`

Checks availability of supported review CLIs (`gemini`, `codex`, `claude`, `github-copilot`).

### `agent-validator init`

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
2. **Development CLI Selection**: Multi-select prompt for your development tools.
3. **Install Scope Selection**: Choose local (project) or global (user) scope for plugin and skill installation.
4. **Review CLI Selection**: Multi-select prompt for review tools. Populates `cli.default_preference` in the user's selection order. If one review CLI is selected, `num_reviews` is set to 1 automatically. If multiple are selected, you're prompted for how many to run per review.
5. **Scaffold `.gauntlet/`**: Creates the directory, config skeleton (`entry_points: []`), and built-in code-quality review. **Skipped entirely** if `.gauntlet/` already exists (config is never overwritten).
6. **Install Plugin & Skills**: For Claude Code, registers the marketplace and installs the agent-validator plugin (which delivers skills and hooks). For Cursor, copies plugin files (manifest, skills, hooks) to `.cursor/plugins/agent-validator/` (project) or `~/.cursor/plugins/agent-validator/` (user). For Codex, copies skill files to `.agents/skills/` (local or `$HOME/.agents/skills/` for global scope). Uses SHA-256 checksums for Codex skill files.
7. **Post-Init Instructions**: Prints context-aware next steps. Native CLIs (Claude Code, Cursor) get `/gauntlet-setup` instructions. Non-native CLIs get `@file_path` skill references with descriptions.

**Re-running init:** When `.gauntlet/` already exists, init delegates to the update flow — refreshing the Claude Code plugin via marketplace and updating Codex skills via checksums. If the plugin isn't installed yet, it falls back to a fresh install. This lets you update after upgrading Agent Gauntlet without re-configuring your project.

After `init`, run `/gauntlet-setup` in your AI agent session to scan the project, discover tooling, and configure checks and entry points. See the [Skills Guide](skills-guide.md) for details.

#### Options

- `-y, --yes`: Skip all interactive prompts. Selects all detected CLIs as both development and review CLIs, sets `num_reviews` to the detected count, and overwrites changed files without asking.

### `agent-validator ci`

Commands for integrating Agent Gauntlet with CI/CD systems (GitHub Actions).

#### `agent-validator ci init`

Generates a dynamic GitHub Actions workflow (`.github/workflows/gauntlet.yml`) and a starter CI configuration (`.gauntlet/ci.yml`).

- The generated workflow uses a "discover" job to dynamically build the job matrix based on changed files and configured checks.
- You generally only need to run this once, or when you add new service dependencies (e.g. Postgres, Redis) to `.gauntlet/ci.yml`.

#### `agent-validator ci list-jobs`

Internal command used by the CI workflow to discover which jobs to run.

- Reads `.gauntlet/ci.yml` and `.gauntlet/config.yml`
- Expands entry points based on file patterns
- Outputs a JSON object defining the job matrix and service configurations

### `agent-validator update`

Updates installed plugins and skills for all supported adapters.

- Detects where the Claude plugin is installed by running `claude plugin list --json`
- If Claude plugin found and installed at both scopes, targets project scope (closest scope wins)
- If Claude plugin found → runs `claude plugin marketplace update` followed by `claude plugin update`
- Detects where the Cursor plugin is installed (file-system check for `.cursor/plugins/agent-validator/`)
- If Cursor plugin found → re-copies plugin assets from the npm package (always overwrite)
- Refreshes Codex skills if installed (using checksum comparison)
- If no plugins are found at all, exits with an error suggesting `agent-validator init`

### `agent-validator update-review`

Manages review violation decisions by stable numeric ID. Used after a gauntlet run to mark violations as fixed or skipped before re-running verification.

Violations are enumerated by scanning review JSON files in the log directory (sorted by filename), collecting violations with `status: "new"`, and assigning sequential IDs from 1. The same enumeration is used by `--report`, so IDs are consistent between the report output and these commands.

#### `agent-validator update-review list`

Lists all pending review violations with their numeric IDs.

```bash
$ agent-validator update-review list
  #1 [high] review:src:code-quality (claude@1)
     src/main.ts:45 - Missing error handling for async database call
     Fix: Wrap in try-catch block

  #2 [medium] review:src:code-quality (claude@1)
     src/utils.ts:22 - Function exceeds 50 lines
     Fix: Extract helper functions
```

#### `agent-validator update-review fix <id> <reason>`

Marks a violation as fixed. Sets `status` to `"fixed"` and `result` to the reason string in the review JSON file.

```bash
agent-validator update-review fix 1 "Added try-catch around database call"
```

#### `agent-validator update-review skip <id> <reason>`

Marks a violation as skipped. Sets `status` to `"skipped"` and `result` to the reason string in the review JSON file. Skipped violations cause the run to report "Passed with warnings" instead of "Failed".

```bash
agent-validator update-review skip 2 "Function is readable at current length"
```

Only violations with `status: "new"` can be updated. Attempting to update an already-fixed or already-skipped violation produces an error.

### `agent-validator validate`

Validates all config files (`.gauntlet/config.yml`, check definitions, review definitions) against their schemas. Useful for catching configuration mistakes without running any gates.

```bash
agent-validator validate
```

Exits `0` if all config files are valid, `1` if validation fails (with the error message printed to stderr).

### `agent-validator skip`

Advances the execution state baseline to the current commit without running any gates. The next `run` will diff from this new baseline.

```bash
agent-validator skip
```

This is useful when you want to skip validation for a known-good state (e.g., after a merge from main) and start fresh from the current commit.

### `agent-validator status`

Shows a summary of the most recent validator session, including gate results and overall outcome.

```bash
agent-validator status
```

### `agent-validator help`

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

For the full schema reference including all fields and their defaults, see [Project config in the Config Reference](config-reference.md#project-config-gauntletconfigyml).

Key configuration sections:
- **base_branch**: The branch/ref to diff against in local runs
- **log_dir**: Directory where job logs are written
- **cli**: CLI tool preferences for reviews
- **entry_points**: Maps paths to their applicable gates

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

The debug log survives `clean` operations and rotates when it exceeds `max_size_mb`.

### Persistent files

The following files in the log directory survive `clean` operations:
- `.execution_state` - Tracks branch, commit, and working tree state
- `.debug.log` - Debug log (when enabled)
- `.debug.log.1` - Rotated debug log

## Troubleshooting

- **“Configuration file not found”**: ensure `.gauntlet/config.yml` exists (or run `agent-validator init`).
- **No gates run**: either no changes were detected, or no entry point matched those changes, or the matching entry point has no gates.
- **Check gate shows “Missing command” in preflight**: the first token of `command` must resolve on `PATH` (or be an executable path).
- **Review gate shows "Missing CLI tools"**: install one of the requested tools (`gemini`, `codex`, `claude`, `github-copilot`) and ensure it's on `PATH`.
