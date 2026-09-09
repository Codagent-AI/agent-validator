---
title: Configuration Reference
group: Reference
order: 2
description: Complete Agent Validator project, check, review, and CI configuration schema.
---

# Configuration Reference

Agent Validator reads project config from `.validator/config.yml`. If `.validator/` does not exist, legacy `.gauntlet/config.yml` is still detected.

## Project Config

```yaml
cli:
  default_preference:
    - codex
  adapters:
    codex:
      allow_tool_use: false
      thinking_budget: medium

entry_points:
  - path: "."
    exclude:
      - validator_logs
    checks:
      - test:
          command: npm test
    reviews:
      - all-reviewers:
          builtin: all-reviewers
```

## Top-Level Fields

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `base_branch` | string | `origin/main` | Ref used for local change detection when no execution-state baseline applies |
| `log_dir` | string | `validator_logs` | Directory for console logs, gate logs, review JSON, reports, and state |
| `allow_parallel` | boolean | `true` | Allows independent gates to run in parallel |
| `max_retries` | number | `3` | Retry attempts before `Retry limit exceeded` |
| `max_previous_logs` | integer | `3` | Number of archived log sessions kept by `clean`; `0` removes ordinary logs without archiving and preserves latest/pending metrics evidence |
| `rerun_new_issue_threshold` | enum | `medium` | Minimum priority for accepting new rerun violations: `critical`, `high`, `medium`, or `low` |
| `cli` | object | required | Review CLI preference and adapter settings |
| `entry_points` | array | required | Paths and gates to activate for changed files |
| `debug_log` | object | optional | Persistent `.debug.log` settings |
| `logging` | object | optional | Structured logging settings |

> [!IMPORTANT]
> The current schema does not allow top-level `checks:` or `reviews:` maps. Define inline gates inside an entry point, or use file-based gates under `.validator/checks/` and `.validator/reviews/`.

## CLI Config

```yaml
cli:
  default_preference:
    - github-copilot
    - codex
  adapters:
    github-copilot:
      allow_tool_use: false
      thinking_budget: low
      model: claude-sonnet-4.6
```

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `default_preference` | string array | adapter keys when omitted | Ordered adapter list for reviews without `cli_preference` |
| `adapters` | map | optional | Per-adapter settings |

Adapter fields:

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allow_tool_use` | boolean | `true` | Whether supported adapters may enable tool use |
| `thinking_budget` | enum | unset | `off`, `low`, `medium`, or `high` |
| `model` | string | unset | Adapter model override |

Supported adapter keys are `claude`, `codex`, `gemini`, `github-copilot`, `cursor`, and `opencode`.

## Entry Points

```yaml
entry_points:
  - path: "src"
    exclude:
      - "**/*.snap"
    checks:
      - lint
      - test:
          command: npm test
    reviews:
      - code-quality:
          builtin: code-quality
```

| Field | Type | Meaning |
| --- | --- | --- |
| `path` | string | Repository path that activates this entry point |
| `exclude` | string array | Glob patterns excluded from this entry point |
| `checks` | array | Check names or inline single-key check definitions |
| `reviews` | array | Review names or inline single-key review definitions |

Inline gate names must be unique across entry points. Define a gate inline once, then reference it by name from other entry points.

## Check Gates

Inline check:

```yaml
entry_points:
  - path: "."
    checks:
      - lint:
          command: npm run lint
          timeout: 300
```

File-based check at `.validator/checks/lint.yml`:

```yaml
command: npm run lint
timeout: 300
```

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `command` | string | required | Shell command to execute |
| `rerun_command` | string | unset | Alternate command used in rerun mode when no explicit `--commit` is supplied |
| `working_directory` | string | current repo | Directory where the command runs |
| `parallel` | boolean | `true` | Whether this check can run in parallel |
| `run_in_ci` | boolean | `true` | Whether this check can run in CI |
| `run_locally` | boolean | `true` | Whether this check can run locally |
| `timeout` | number | `300` | Timeout in seconds |
| `fail_fast` | boolean | unset | Only valid when `parallel: false` |
| `fix_instructions_file` | string | unset | File with fix instructions, resolved from `.validator/` unless absolute |
| `fix_instructions` | string | unset | Deprecated alias for `fix_instructions_file` |
| `fix_with_skill` | string | unset | Agent skill to invoke for failed checks |

`fix_instructions_file` and `fix_with_skill` are mutually exclusive.

## Review Gates

Inline built-in review:

```yaml
entry_points:
  - path: "."
    reviews:
      - code-quality:
          builtin: code-quality
          cli_preference:
            - github-copilot
          model: claude-sonnet-4.6
```

YAML review file at `.validator/reviews/security.yml`:

```yaml
builtin: security
num_reviews: 1
```

Markdown review file at `.validator/reviews/architecture.md`:

```markdown
---
cli_preference:
  - codex
num_reviews: 1
---

# Architecture Review

Review the diff for architecture issues.
```

Review fields:

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `prompt_file` | string | unset | Prompt file path resolved from `.validator/` unless absolute |
| `skill_name` | string | unset | Skill name used instead of prompt content |
| `builtin` | string | unset | Built-in prompt name for YAML or inline reviews |
| `model` | string | unset | Per-review model override |
| `cli_preference` | string array | `cli.default_preference` | Ordered adapters for this review |
| `num_reviews` | number | `1` | Number of review attempts/adapters |
| `parallel` | boolean | `true` | Whether review jobs can run in parallel |
| `run_in_ci` | boolean | `true` | Whether the review can run in CI |
| `run_locally` | boolean | `true` | Whether the review can run locally |
| `timeout` | number | unset | Review timeout in seconds |
| `enabled` | boolean | `true` | Disabled reviews require `--enable-review` |
| `one_shot` | boolean | `false` | Preserve prior result on reruns instead of dispatching again |

YAML and inline reviews must specify exactly one of `prompt_file`, `skill_name`, or `builtin`. Markdown reviews use the markdown body unless `prompt_file` or `skill_name` appears in frontmatter.

## Built-In Reviews

| Built-in | Behavior |
| --- | --- |
| `code-quality` | Primary code quality prompt |
| `security` | Primary security prompt |
| `error-handling` | Primary error handling prompt |
| `security-and-errors` | Combined security and error-handling prompt |
| `all-reviewers` | Combined code-quality, security, and error-handling prompt |
| `task-compliance` | Opt-in built-in; defaults `one_shot` to `true` unless explicitly set |
| `test-integrity` | Opt-in built-in |

## Context Injection

Review prompts can include `{{CONTEXT}}`. At runtime, pass:

```bash
agent-validate run --enable-review task-compliance --context-file tasks/feature.md
```

If the context file is missing, the command fails. If a prompt has no `{{CONTEXT}}` placeholder, the context file is ignored for that prompt.

## Debug Log

```yaml
debug_log:
  enabled: true
  max_size_mb: 10
```

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` when `debug_log` is present | Enables persistent debug log writing |
| `max_size_mb` | number | `10` | Rotates `.debug.log` to `.debug.log.1` after this size |

If neither project nor global config enables debug logging, no `.debug.log` is written.

## Logging

```yaml
logging:
  level: debug
  console:
    enabled: true
    format: pretty
  file:
    enabled: true
    format: text
```

| Field | Values | Default |
| --- | --- | --- |
| `level` | `debug`, `info`, `warning`, `error` | `debug` |
| `console.enabled` | boolean | `true` |
| `console.format` | `pretty`, `json` | `pretty` |
| `file.enabled` | boolean | `true` |
| `file.format` | `text`, `json` | `text` |

## CI Config

`.validator/ci.yml` is optional and used by `agent-validate ci`.

```yaml
runtimes:
  node:
    version: "22"

services:
  postgres:
    image: postgres:16

setup:
  - name: Install dependencies
    run: npm ci

checks:
  - name: test
    requires_runtimes:
      - node
    requires_services:
      - postgres
    setup:
      - name: Prepare database
        run: npm run db:prepare
```

| Field | Type | Meaning |
| --- | --- | --- |
| `runtimes` | map or null | Provider-specific runtime config |
| `services` | map or null | Provider-specific service config |
| `setup` | array or null | Global setup steps |
| `checks` | array or null | Per-check CI metadata |

Setup steps support `name`, `run`, optional `working_directory`, and optional `if`.
