# Config Reference

This document lists the configuration files Agent Validator loads and all supported fields **as implemented**.

## Files and where they live

```text
.validator/
  config.yml              # project config (required)
  checks/
    *.yml                 # check gate definitions (file-per-gate; also supported)
  reviews/
    *.md                  # review gate prompts as markdown (filename is gate name)
    *.yml                 # review gate configs as YAML (filename is gate name)
```

## Project config: `.validator/config.yml`

### Schema

- **base_branch**: string (default: `origin/main`)  
  The git ref used as the “base” when detecting changes locally (via `git diff base...HEAD`). In CI, the runner prefers GitHub-provided refs (e.g. `GITHUB_BASE_REF`) when available.
- **log_dir**: string (default: `validator_logs`)  
  Directory where per-job logs are written. Each gate run writes a log file named from the job id (sanitized).
- **cli**: object (required)
  - **default_preference**: string[] (required)
    Default ordered list of review CLI tools to try when a review gate doesn't specify its own `cli_preference`.
  - **adapters**: object (optional)
    Per-adapter configuration overrides. Keys are adapter names (e.g., `claude`, `codex`, `gemini`, `github-copilot`, `cursor`).
    - **model**: string (optional)
      Model name to pass to the adapter. Behavior varies by adapter — Claude uses `--model`, Codex uses `--model`, Copilot uses `--model` (free-form, no resolution). Adapters that don't support model selection ignore this.
    - **allow_tool_use**: boolean (default: `true`)
      Whether to grant the adapter read-only tool access during reviews. When `false`, no tool-use flags are passed.
    - **thinking_budget**: string (optional)
      Reasoning effort level. Valid values: `off`, `low`, `medium`, `high`. For Copilot, maps to the `--effort` flag. For Claude, maps to `--thinking-budget`.
- **allow_parallel**: boolean (default: `true`)
  If `true`, gates with `parallel: true` run concurrently, while `parallel: false` gates run sequentially. If `false`, all gates run sequentially regardless of per-gate settings.
- **max_retries**: number (default: `3`)
  Maximum number of retry attempts before declaring "Retry limit exceeded". After the initial run, the system allows up to this many additional runs to fix issues.
- **max_previous_logs**: number (default: `3`)
  Maximum number of archived session directories to keep during log rotation. When logs are cleaned (manually or automatically), the current session is archived into `previous/`, and existing archives shift: `previous/` becomes `previous.1/`, `previous.1/` becomes `previous.2/`, etc. The oldest archive beyond this count is deleted. Set to `0` to disable archiving entirely (logs are deleted on clean). Set to `1` for single-generation archiving (pre-existing behavior).
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
- **entry_points**: array (required)
  Declares which parts of the repo are "scopes" for change detection and which gates run for each scope. Only entry points with detected changes will produce jobs. After `agent-validator init`, this starts as `[]` (empty) and is populated by the `/validator-setup` skill.
  - **path**: string (required)  
    The scope path for the entry point. Supports fixed paths like `apps/api` and a trailing wildcard form like `packages/*` which expands to one job per changed subdirectory.
  - **checks**: array (optional)  
    Which check gates to run when this entry point is active. Each item is either a **string** (name referencing a file-based gate in `.validator/checks/`) or an **inline definition** (a single-key object where the key is the gate name and the value is a check config object — same schema as `.validator/checks/*.yml` files, see [Check gates](#check-gates)). Inline checks and file-based checks are merged at load time; if the same name appears in both sources, the system rejects with a validation error. A check name may only be defined inline in one entry point; other entry points reference it by name.
  - **reviews**: array (optional)  
    Which review gates to run when this entry point is active. Each item is either a **string** (name referencing a file-based gate in `.validator/reviews/`) or an **inline definition** (a single-key object where the key is the gate name and the value is a review config object — same schema as `.validator/reviews/*.yml` files, see [Review gates](#review-gates)). Inline reviews and file-based reviews are merged at load time; if the same name appears in both sources, the system rejects with a validation error. A review name may only be defined inline in one entry point; other entry points reference it by name.

### Example

```yaml
base_branch: origin/main
log_dir: validator_logs
allow_parallel: true
max_previous_logs: 3
cli:
  default_preference:
    - gemini
    - codex
    - claude
    - github-copilot
  adapters:
    claude:
      allow_tool_use: false
      thinking_budget: high
    github-copilot:
      model: gpt-4o
      thinking_budget: medium
debug_log:
  enabled: true
  max_size_mb: 10

entry_points:
  - path: "."
    reviews:
      - code-quality:
          builtin: code-quality
          num_reviews: 1

  - path: apps/api
    checks:
      - test:
          command: npm run test
      - lint:
          command: npx eslint .
    reviews:
      - code-quality
      - architecture

  - path: packages/*
    checks:
      - lint
```

## Check gates

Check gates can be defined **inline** within an entry point's `checks` array (preferred) or as separate files in `.validator/checks/*.yml` (also supported). Both styles use the same schema. For file-based checks, the gate name is derived from the filename (e.g. `lint.yml` → `lint`). For inline checks, the gate name is the object key.

### Schema

- **command**: string (required)
  Shell command to execute for the check (e.g. tests, lint, typecheck). The gate passes if the command exits with code `0`. Supports variable substitution: `${BASE_BRANCH}` is replaced with the effective base branch.
- **rerun_command**: string (optional)
  Alternate shell command to use when the system is in rerun mode (log files exist from a previous run and no explicit `--commit` target is specified). Supports the same variable substitution as `command` (e.g. `${BASE_BRANCH}`). When not defined, `command` is used for both first runs and reruns.
- **working_directory**: string (optional; default: entry point path)
  Directory to run the command in (`cwd`). If omitted, the command runs in the entry point directory for the job.
- **parallel**: boolean (default: `true`)
  If `true` (and project-level `allow_parallel` is enabled), this gate may run concurrently with other parallel gates. If `false`, it runs in the sequential lane.
- **run_in_ci**: boolean (default: `true`)
  Whether this check gate runs when CI mode is detected (e.g. GitHub Actions). If `false`, the gate is skipped in CI.
- **run_locally**: boolean (default: `true`)
  Whether this check gate runs in local (non-CI) execution. If `false`, the gate is skipped locally.
- **timeout**: number seconds (default: `300`)
  Maximum time allowed for the command; if exceeded, the check is marked as failed due to timeout. Timeouts are enforced per job.
- **fail_fast**: boolean (optional; can only be used when `parallel` is `false`)
  If `true`, a failure/error in this gate stops scheduling subsequent work. Note: the current implementation enforces fail-fast at scheduling time; parallel jobs may already be running.
- **fix_instructions_file**: string (optional)
  Path to a file containing instructions for fixing failures. Relative paths resolve from `.validator/`. Absolute paths are allowed but log a security warning. Mutually exclusive with `fix_with_skill`.
- **fix_with_skill**: string (optional)
  Name of a CLI skill to use for fixing failures. When the check fails, the skill name is included in the gate result for consumers. Mutually exclusive with `fix_instructions_file`.
- **fix_instructions**: string (optional; **deprecated**)
  Deprecated alias for `fix_instructions_file`. Cannot be specified alongside `fix_instructions_file`.

### Example

```yaml
command: bun test
working_directory: .
run_in_ci: true
run_locally: true
fix_instructions_file: fix-guides/test-failures.md
```

## Review gates

Review gates can be defined **inline** within an entry point's `reviews` array (preferred for simple configs like built-in references), or as separate files in `.validator/reviews/`:

- **Inline** (in entry point): Same schema as `.validator/reviews/*.yml` files. Gate name is the object key.
- **Markdown files** (`.md`): Gate name is the filename without extension. Best for reviews with custom prompts.
- **YAML files** (`.yml`/`.yaml`): Gate name is the filename without extension.

If both a `.md` and `.yml`/`.yaml` file share the same base name, the system rejects the configuration with an error. If the same name appears inline and as a file, the system also rejects with an error.

### Markdown reviews (`.md`)

The review prompt is the Markdown content after the YAML frontmatter. Optionally, `prompt_file` or `skill_name` can be specified in frontmatter to override the body.

### YAML reviews (`.yml`/`.yaml`)

YAML review files must specify exactly one of `prompt_file`, `skill_name`, or `builtin`.

### Schema (frontmatter for `.md`, top-level for `.yml`)

- **enabled**: boolean (default: `true`)
  Whether this review runs by default. Set to `false` to make the review opt-in — it will be skipped unless explicitly activated at runtime via `--enable-review <name>`. Useful for reviews that are only meaningful in specific contexts (e.g. task-compliance reviews that require an active task context).
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
  Path to an external file containing the review prompt. Relative paths resolve from `.validator/`. Absolute paths are allowed but log a security warning. For `.md` files, this overrides the markdown body. For `.yml` files, this is one of three required prompt sources. Mutually exclusive with `skill_name` and `builtin`.
- **skill_name**: string (optional)
  Name of a CLI skill to delegate the review to. When set, no prompt content is loaded. For `.yml` files, this is one of three required prompt sources. Mutually exclusive with `prompt_file` and `builtin`.
- **builtin**: string (optional, `.yml` only)
  Name of a built-in review prompt bundled with the package (e.g. `code-quality`). Loads the prompt from the built-in review library. Mutually exclusive with `prompt_file` and `skill_name`.

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
num_reviews: 1
---

# Code quality review

Review the diff for code quality issues. Focus on readability and maintainability.
```

**Markdown review disabled by default (opt-in):**

```markdown
---
num_reviews: 1
enabled: false
---

# Task compliance review

Review the diff against the task requirements in the provided context.
```

To activate an opt-in review at runtime, use `--enable-review <name>` on the `run` or `review` commands (see [User Guide](user-guide.md#agent-validator-run)).

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

**YAML review with built-in prompt:**

```yaml
builtin: code-quality
num_reviews: 2
```
