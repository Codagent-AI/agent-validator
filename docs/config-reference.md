# Config Reference

This document lists the configuration files Agent Gauntlet loads and all supported fields **as implemented**.

## Files and where they live

```text
.gauntlet/
  config.yml              # project config (required)
  checks/
    *.yml                 # check gate definitions (optional)
  reviews/
    *.md                  # review gate prompts as markdown (optional; filename is gate name)
    *.yml                 # review gate configs as YAML (optional; filename is gate name)
```

## Project config: `.gauntlet/config.yml`

### Schema

- **base_branch**: string (default: `origin/main`)  
  The git ref used as the “base” when detecting changes locally (via `git diff base...HEAD`). In CI, the runner prefers GitHub-provided refs (e.g. `GITHUB_BASE_REF`) when available.
- **log_dir**: string (default: `gauntlet_logs`)  
  Directory where per-job logs are written. Each gate run writes a log file named from the job id (sanitized).
- **cli**: object (required)
  - **default_preference**: string[] (required)  
    Default ordered list of review CLI tools to try when a review gate doesn't specify its own `cli_preference`.
- **allow_parallel**: boolean (default: `true`)
  If `true`, gates with `parallel: true` run concurrently, while `parallel: false` gates run sequentially. If `false`, all gates run sequentially regardless of per-gate settings.
- **max_retries**: number (default: `3`)
  Maximum number of retry attempts before declaring "Retry limit exceeded". After the initial run, the system allows up to this many additional runs to fix issues.
- **rerun_new_issue_threshold**: enum (default: `"medium"`)
  Priority threshold for filtering new violations during reruns. Valid values: `"critical"`, `"high"`, `"medium"`, `"low"`. During verification mode (when logs exist), new violations with priority below this threshold are filtered out, allowing you to focus on fixing original issues first. For example, with the default `"medium"` threshold, new `"low"` priority issues won't block the rerun.
- **debug_log**: object (optional)
  Configuration for persistent debug logging. When enabled, writes detailed execution logs to `.debug.log` in the log directory. This file survives `clean` operations.
  - **enabled**: boolean (default: `false`)
    Whether to enable debug logging.
  - **max_size_mb**: number (default: `10`)
    Maximum size of the debug log file in megabytes. When exceeded, the current log is rotated to `.debug.log.1` and a new log is started.
- **logging**: object (optional)
  Configuration for structured logging via LogTape.
  - **level**: `"debug"` | `"info"` | `"warning"` | `"error"` (default: `"debug"`)
    Minimum log level to capture.
  - **console**: object (optional)
    Console logging output settings.
    - **enabled**: boolean (default: `true`)
    - **format**: `"pretty"` | `"json"` (default: `"pretty"`)
  - **file**: object (optional)
    File logging output settings.
    - **enabled**: boolean (default: `true`)
    - **format**: `"text"` | `"json"` (default: `"text"`)
- **stop_hook**: object (optional)
  Configuration for the stop hook behavior. These settings can be overridden by environment variables (see [Environment Variable Overrides](#environment-variable-overrides)).
  - **enabled**: boolean (optional; default from global config, typically `true`)
    Whether the stop hook gauntlet is enabled for this project. Set to `false` to disable stop hook validation entirely.
  - **run_interval_minutes**: number (optional; default from global config, typically `5`)
    Minimum minutes between gauntlet runs. Set to `0` to always run the gauntlet on every stop attempt.
  - **auto_push_pr**: boolean (optional; default `false`)
    When enabled, the stop hook checks whether a PR exists and is up to date after gates pass. If no PR exists or the PR HEAD doesn't match the local HEAD, the hook blocks with `pr_push_required` and provides instructions for creating/updating a PR.
- **auto_fix_pr**: boolean (optional; default `false`)
  When enabled (and `auto_push_pr` is also enabled), the stop hook waits for CI checks after a PR is created. If checks fail or blocking reviews are present, it blocks with fix instructions; if checks pass, it approves.
- **entry_points**: array (required)  
  Declares which parts of the repo are “scopes” for change detection and which gates run for each scope. Only entry points with detected changes will produce jobs.
  - **path**: string (required)  
    The scope path for the entry point. Supports fixed paths like `apps/api` and a trailing wildcard form like `packages/*` which expands to one job per changed subdirectory.
  - **checks**: string[] (optional; names of gates from `.gauntlet/checks/*.yml`)  
    Which check gate names to run when this entry point is active. Names must match the `name` field inside the corresponding check YAML.
  - **reviews**: string[] (optional; names from `.gauntlet/reviews/*.md` filenames)  
    Which review gate names to run when this entry point is active. Names come from review prompt filenames (e.g. `security.md` → `security`).

### Example

```yaml
base_branch: origin/main
log_dir: gauntlet_logs
allow_parallel: true
cli:
  default_preference:
    - gemini
    - codex
    - claude
    - github-copilot
debug_log:
  enabled: true
  max_size_mb: 10

entry_points:
  - path: "."
    reviews:
      - code-quality

  - path: apps/api
    checks:
      - test
      - lint
    reviews:
      - architecture

  - path: packages/*
    checks:
      - lint
```

## Environment Variable Overrides

Stop hook configuration can be overridden using environment variables. This is useful for CI/CD pipelines or temporary disabling of the stop hook.

**Precedence order** (highest to lowest):
1. Environment variables
2. Project config (`.gauntlet/config.yml`)
3. Global config (`~/.config/agent-gauntlet/config.yml`)

| Variable | Values | Description |
|----------|--------|-------------|
| `GAUNTLET_STOP_HOOK_ENABLED` | `true`, `1`, `false`, `0` | Override whether stop hook is enabled |
| `GAUNTLET_STOP_HOOK_INTERVAL_MINUTES` | Non-negative integer | Override run interval (0 = always run) |
| `GAUNTLET_AUTO_PUSH_PR` | `true`, `1`, `false`, `0` | Override whether auto PR push check is enabled |
| `GAUNTLET_AUTO_FIX_PR` | `true`, `1`, `false`, `0` | Override whether auto-fix PR CI wait workflow is enabled |

Each field is resolved independently, so you can set one via environment variable while using config files for the other.

### Examples

```bash
# Disable stop hook for this session
GAUNTLET_STOP_HOOK_ENABLED=false claude

# Always run gauntlet on every stop (no interval throttling)
GAUNTLET_STOP_HOOK_INTERVAL_MINUTES=0 claude

# Combine both
GAUNTLET_STOP_HOOK_ENABLED=true GAUNTLET_STOP_HOOK_INTERVAL_MINUTES=5 claude
```

## Check gates: `.gauntlet/checks/*.yml`

Check gate names are derived from the filename (e.g. `lint.yml` → gate name `lint`).

### Schema

- **command**: string (required)
  Shell command to execute for the check (e.g. tests, lint, typecheck). The gate passes if the command exits with code `0`.
- **working_directory**: string (optional; default: entry point path)
  Directory to run the command in (`cwd`). If omitted, the command runs in the entry point directory for the job.
- **parallel**: boolean (default: `false`)
  If `true` (and project-level `allow_parallel` is enabled), this gate may run concurrently with other parallel gates. If `false`, it runs in the sequential lane.
- **run_in_ci**: boolean (default: `true`)
  Whether this check gate runs when CI mode is detected (e.g. GitHub Actions). If `false`, the gate is skipped in CI.
- **run_locally**: boolean (default: `true`)
  Whether this check gate runs in local (non-CI) execution. If `false`, the gate is skipped locally.
- **timeout**: number seconds (optional)
  Maximum time allowed for the command; if exceeded, the check is marked as failed due to timeout. Timeouts are enforced per job.
- **fail_fast**: boolean (optional; can only be used when `parallel` is `false`)
  If `true`, a failure/error in this gate stops scheduling subsequent work. Note: the current implementation enforces fail-fast at scheduling time; parallel jobs may already be running.
- **fix_instructions_file**: string (optional)
  Path to a file containing instructions for fixing failures. Relative paths resolve from `.gauntlet/`. Absolute paths are allowed but log a security warning. Mutually exclusive with `fix_with_skill`.
- **fix_with_skill**: string (optional)
  Name of a CLI skill to use for fixing failures. When the check fails, the skill name is included in the gate result for consumers. Mutually exclusive with `fix_instructions_file`.
- **fix_instructions**: string (optional; **deprecated**)
  Deprecated alias for `fix_instructions_file`. Cannot be specified alongside `fix_instructions_file`.

### Example

```yaml
command: bun test
working_directory: .
parallel: false
run_in_ci: true
run_locally: true
timeout: 300
fail_fast: false
fix_instructions_file: fix-guides/test-failures.md
```

## Review gates: `.gauntlet/reviews/*.md` and `.gauntlet/reviews/*.yml`

Review gates can be defined as either Markdown files (`.md`) or YAML files (`.yml`/`.yaml`).

- The gate name is the **filename without extension** (e.g. `security.md` or `security.yml` → `security`).
- If both a `.md` and `.yml`/`.yaml` file share the same base name, the system rejects the configuration with an error.

### Markdown reviews (`.md`)

The review prompt is the Markdown content after the YAML frontmatter. Optionally, `prompt_file` or `skill_name` can be specified in frontmatter to override the body.

### YAML reviews (`.yml`/`.yaml`)

YAML review files must specify exactly one of `prompt_file` or `skill_name`.

### Schema (frontmatter for `.md`, top-level for `.yml`)

- **cli_preference**: string[] (optional)
  Ordered list of review CLI tools to try (e.g. `gemini`, `codex`, `claude`, `github-copilot`). If omitted, the project-level `cli.default_preference` is used.
- **num_reviews**: number (default: `1`)
  How many tools to run for this review gate. If greater than 1, multiple CLIs are executed and the gate fails if any of them fail pass/fail evaluation.
- **parallel**: boolean (default: `true`)
  If `true` (and project `allow_parallel` is enabled), this review gate may run concurrently with other parallel gates. If `false`, it runs in the sequential lane.
- **run_in_ci**: boolean (default: `true`)
  Whether this review gate runs when CI mode is detected. If `false`, the review gate is skipped in CI.
- **run_locally**: boolean (default: `true`)
  Whether this review gate runs in local (non-CI) execution. If `false`, the review gate is skipped locally.
- **timeout**: number seconds (optional)
  Maximum time allowed for each CLI execution for this review gate. If exceeded, the job is marked as an error.
- **model**: string (optional)
  Optional model hint passed to adapters that support it. Adapters that don't support model selection will ignore this value.
- **prompt_file**: string (optional)
  Path to an external file containing the review prompt. Relative paths resolve from `.gauntlet/`. Absolute paths are allowed but log a security warning. For `.md` files, this overrides the markdown body. For `.yml` files, this is one of two required prompt sources. Mutually exclusive with `skill_name`.
- **skill_name**: string (optional)
  Name of a CLI skill to delegate the review to. When set, no prompt content is loaded. For `.yml` files, this is one of two required prompt sources. Mutually exclusive with `prompt_file`.

**JSON Output format**

All reviews are automatically instructed to output strict JSON. You do not need to prompt the model for formatting.

### Examples

**Markdown review with inline prompt:**

```markdown
---
cli_preference:
  - gemini
  - codex
  - claude
  - github-copilot
num_reviews: 2
timeout: 120
---

# Code quality review

Review the diff for code quality issues. Focus on readability and maintainability.
```

**Markdown review with external prompt file:**

```markdown
---
prompt_file: prompts/security-review.md
cli_preference:
  - claude
---
```

**YAML review with external prompt file:**

```yaml
prompt_file: prompts/security-review.md
cli_preference:
  - claude
```

**YAML review with skill:**

```yaml
skill_name: code-review
num_reviews: 2
```
