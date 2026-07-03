---
title: Configuring Gates
group: Configuration
order: 1
description: Configure entry points, checks, reviews, and built-in review prompts.
---

# Configuring Gates

Agent Validator reads project configuration from `.validator/config.yml`. Legacy `.gauntlet/config.yml` is still detected when `.validator/` is absent.

## Entry Points

Entry points live under `entry_points`. Each entry point has a `path` and optional `checks`, `reviews`, and `exclude` patterns.

```yaml
cli:
  default_preference:
    - codex

entry_points:
  - path: "."
    exclude:
      - validator_logs
      - .validator
    checks:
      - build:
          command: npm run build
      - test:
          command: npm test
    reviews:
      - all-reviewers:
          builtin: all-reviewers
          cli_preference:
            - codex
```

> [!IMPORTANT]
> Inline check and review definitions belong inside an entry point's `checks` or `reviews` array. Top-level `checks:` and `reviews:` maps are not accepted by the current schema.

## Path Matching

| Entry point | Behavior |
| --- | --- |
| `.` | Runs for any changed file |
| `apps/api` | Runs when that path or a child path changes |
| `packages/*` | Expands one level based on changed paths, such as `packages/ui` |

`exclude` patterns remove files from an entry point match. Use them for generated output, logs, or docs that should not trigger a gate.

## Check Gates

A check gate runs a shell command and passes when the command exits with code `0`.

```yaml
entry_points:
  - path: "src"
    checks:
      - lint:
          command: npm run lint
          timeout: 300
          working_directory: "."
          rerun_command: npm run lint -- --fix-dry-run
```

File-based checks are also supported. A file at `.validator/checks/lint.yml` defines a gate named `lint`:

```yaml
command: npm run lint
timeout: 300
```

Reference a file-based gate by name:

```yaml
entry_points:
  - path: "src"
    checks:
      - lint
```

## Review Gates

A review gate dispatches a prompt through a configured AI CLI adapter. It produces structured JSON with violations, priority, status, and fix suggestions.

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

File-based reviews are supported under `.validator/reviews/`:

- `.md` files contain a custom prompt plus optional frontmatter.
- `.yml` or `.yaml` files reference `prompt_file`, `skill_name`, or `builtin`.

## Built-In Reviews

| Built-in | Type | Notes |
| --- | --- | --- |
| `code-quality` | Primary | Bugs, correctness, maintainability |
| `security` | Primary | Security issues and data exposure |
| `error-handling` | Primary | Missing or incorrect error handling |
| `security-and-errors` | Combined | `security` plus `error-handling` |
| `all-reviewers` | Combined | Code quality, security, and error handling |
| `task-compliance` | Opt-in | Defaults to one-shot; expects context |
| `test-integrity` | Opt-in | Checks test quality and coverage integrity |

Opt-in built-ins must be configured and referenced before `--enable-review` can activate them:

```yaml
entry_points:
  - path: "."
    reviews:
      - task-compliance:
          builtin: task-compliance
          enabled: false
```

Then activate it for one run:

```bash
agent-validate run --enable-review task-compliance --context-file tasks/implement-feature.md
```

## Next Steps

- See the complete schema in [Configuration Reference](config-reference.md).
- See review adapter behavior in [Reviews and Adapters](reviews-and-adapters.md).
- See run behavior in [Running Validation](running-validation.md).
