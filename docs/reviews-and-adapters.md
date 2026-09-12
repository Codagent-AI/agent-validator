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

## Runner Reviewer Override

Agent Runner can inherit a `{cli, model, effort}` reviewer triple into the Validator process through environment variables. Validator applies that triple as an in-memory overlay on overlay commands. It never rewrites the tracked `.validator/config.yml`, so a Runner profile can disagree with the file on disk.

| Variable | Meaning |
| --- | --- |
| `AGENT_VALIDATOR_REVIEWER_CLI` | Runner CLI name to map onto a Validator adapter |
| `AGENT_VALIDATOR_REVIEWER_MODEL` | Optional model overlay |
| `AGENT_VALIDATOR_REVIEWER_EFFORT` | Optional effort overlay |

Values are trimmed; empty or whitespace-only values are treated as absent. Override mode activates when at least one of the three variables has a non-empty trimmed value. Once active, `AGENT_VALIDATOR_REVIEWER_CLI` must be present, non-empty after trim, and mapped; otherwise the overlay command fails immediately and does not fall back to the project's configured reviewers. Absent model or effort leaves those adapter fields unchanged.

### CLI mapping

| Runner CLI | Validator adapter |
| --- | --- |
| `claude` | `claude` |
| `codex` | `codex` |
| `cursor` | `cursor` |
| `opencode` | `opencode` |
| `copilot` | `github-copilot` |

Comparison is exact after trim: `Copilot` is not `copilot`. `gemini` is a valid Validator adapter but is not a mapped Runner CLI value, so it is rejected.

### Effort mapping

| Runner effort | `thinking_budget` |
| --- | --- |
| `low` | `low` |
| `medium` | `medium` |
| `high` | `high` |
| `xhigh` | `high` (lossy collapse) |

Effort cannot express `thinking_budget: off`. Unknown effort fails the overlay command.

### Adapter policy

`allow_tool_use` is never copied from the adapter being replaced. If `cli.adapters.<mapped>` already exists, Validator keeps that block's `allow_tool_use` and applies the role's model and mapped thinking budget on top. If that block does not exist, Validator creates it from init defaults (`allow_tool_use: false` plus the adapter's documented init `thinking_budget` and `model` where present), then applies the role's model and mapped thinking budget. When the role supplies a model, that overlay adapter model takes precedence over a per-review YAML `model`.

Gates, checks, review enablement, and `num_reviews` stay as configured. `num_reviews` greater than one produces that many slots of the one mapped adapter.

### Overlay commands

The overlay applies only to `run`, `review`, `health`, `list`, and `detect`. `check`, `validate`, `clean`, `skip`, `update-review`, metrics operations, and CI job listing ignore these variables and use the tracked project configuration.

When override mode is active, the RESULTS SUMMARY on stderr and `--report` stdout name the configured review identity after the status line:

```text
Reviewer: github-copilot (runner-reviewer-role)
Reviewer: claude (runner-reviewer-role; effort xhigh→high)
```

That line is the requested overlay (source `runner-reviewer-role`, mapped adapter, and the `xhigh` collapse when it occurred), not telemetry-observed effective model identity. It is omitted when no override is active. A trusted short-circuit still names the identity in `--report` output; trust matching itself is unchanged.

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
