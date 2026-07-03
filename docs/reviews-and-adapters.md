---
title: Reviews and Adapters
group: Usage
order: 2
description: Built-in reviews, adapter configuration, and reviewer recommendations.
---

# Reviews and Adapters

Review gates dispatch prompts to local CLI tools. Agent Validator treats the CLI as the execution boundary: it prepares the diff and prompt, invokes the adapter, parses the result, and records structured JSON.

## Supported Adapters

| Adapter name | CLI used | Notes |
| --- | --- | --- |
| `claude` | `claude` | Claude Code CLI |
| `codex` | `codex` | Codex CLI |
| `gemini` | `gemini` | Gemini CLI |
| `github-copilot` | `copilot` | Standalone GitHub Copilot CLI |
| `cursor` | `cursor-agent` or `agent` | Cursor command-line agent |
| `opencode` | `opencode` | OpenCode CLI |

Use the registry key in `cli.default_preference`, `cli.adapters`, and review `cli_preference`.

## Adapter Settings

Adapter settings live under `cli.adapters`:

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
    codex:
      allow_tool_use: false
      thinking_budget: medium
```

| Field | Values | Meaning |
| --- | --- | --- |
| `allow_tool_use` | boolean | Whether the adapter may allow model tool use when supported |
| `thinking_budget` | `off`, `low`, `medium`, `high` | Adapter-specific reasoning/effort setting |
| `model` | string | Adapter model override |

See [CLI Invocation Details](cli-invocation-details.md) for exact subprocess behavior.

## Built-In Review Prompts

| Built-in | Covers | Notes |
| --- | --- | --- |
| `code-quality` | Bugs, logic, maintainability | Primary built-in |
| `security` | Auth, injection, exposure | Primary built-in |
| `error-handling` | Error paths and failure modes | Primary built-in |
| `security-and-errors` | Security plus error handling | Combined built-in |
| `all-reviewers` | Code quality, security, and error handling | Combined built-in |
| `task-compliance` | Implementation against task context | Opt-in; one-shot by default |
| `test-integrity` | Test meaningfulness and coverage quality | Opt-in |

## Recommended Defaults

The current init recommendation logic is:

| Detected review CLI | Generated review config |
| --- | --- |
| `github-copilot` available | Two-pass hybrid: `code-quality` via Sonnet and `security-and-errors` via GPT |
| `codex` available, Copilot unavailable | Single `all-reviewers` pass with GPT Codex |
| Neither available | Single `all-reviewers` pass without adapter-specific model overrides |

The review evaluation harness is documented in [Review Eval Framework](eval-framework.md). Dated eval reports live in this repository for historical detail.

> [!NOTE]
> `task-compliance` requires useful context. Activate it with `--context-file` so `{{CONTEXT}}` in the prompt receives the task or spec text.

## Review Decisions

Review JSON violations start with `status: "new"`. Mark addressed issues before rerunning:

```bash
agent-validate update-review list
agent-validate update-review fix 1 "Added missing error handling"
agent-validate update-review skip 2 "False positive; invariant is enforced by schema"
```

Skipped violations produce `Passed with warnings` instead of `Failed`.
