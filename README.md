![Agent Validator logo](docs/images/agent-validator-logo.png)

[![CI](https://github.com/Codagent-AI/agent-validator/actions/workflows/validator.yml/badge.svg)](https://github.com/Codagent-AI/agent-validator/actions/workflows/validator.yml)
[![npm](https://img.shields.io/npm/v/agent-validator)](https://www.npmjs.com/package/agent-validator)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![OpenSpec](https://raw.githubusercontent.com/Codagent-AI/agent-validator/gh-pages/badges/number_of_specs.svg)](https://github.com/Codagent-AI/agent-validator)
<!-- [![npm downloads](https://img.shields.io/npm/dm/agent-validator)](https://www.npmjs.com/package/agent-validator) -->
<!-- [![CodeRabbit](https://img.shields.io/coderabbit/prs/github/Codagent-AI/agent-validator)](https://coderabbit.ai) -->

> Don't just review the agent's code — put it through the gauntlet.

Agent Validator (formerly Agent Gauntlet) is a configurable “feedback loop” runner for AI-assisted development workflows.

You configure which paths in your repo should trigger which validations — shell commands like tests and linters, plus AI-powered local code reviews. When files change, Agent Validator automatically runs the relevant validations and reports results.

For AI reviews, it uses the CLI tool of your choice: Gemini, Codex, Claude Code, GitHub Copilot, or Cursor. 

## Features

- **Agent validation loop**: Keep your coding agent on track with automated feedback loops. Detect problems — deterministically and/or non-deterministically — and let your agent fix and Agent Validator verify.
- **Local cross-agent code reviews**: Enable one AI agent to automatically request code reviews from another. For example, if Claude made changes, Agent Validator can request a review from Codex — spreading token usage across your subscriptions instead of burning through one.
  - Multiple AI review adapters have been evaluated for quality and efficiency. Claude and Codex deliver optimal review quality with superior token efficiency. For detailed metrics, see [Eval Results](docs/eval-results.md).
- **Leverage existing subscriptions**: Agent Validator is *free* and tool-agnostic, leveraging the AI CLI tools you already have installed.
- **Easy CI setup**: Define your CI gates once, run them locally and in GitHub.


### Example Workflow

1. Claude implements a feature
2. Agent Validator reports linter failures and bugs detected by Codex reviewer agent
3. Claude fixes issues
4. Agent Validator reports linter issue remaining
5. Claude fixes issue
6. Agent Validator confirms all issues fixed

![Agent Validator Demo](docs/images/agent-validator-demo.gif)

### Comparison vs Other Tools

Agent Validator is not a replacement for AI pull request review tools. It provides real-time feedback loops for autonomous coding agents, combining deterministic static checks (build, lint, test) with multi-agent AI reviews in a single pipeline. This enables agents to iterate and self-correct until all checks and reviews pass, without human intervention.

[Full comparison →](docs/feature_comparison.md)

It is recommended to use Agent Validator in conjunction with spec-driven development tools. We believe it is the ideal implementation of the validation step in any Spec → Implement → Validate workflow.

## Quick Start

### Requirements

- **Node.js** (v18.0.0+), **git**
- For reviews: one or more supported AI CLIs (`gemini`, `codex`, `claude`, `github-copilot`, `cursor`). See [CLI Invocation Details](docs/cli-invocation-details.md).

### Installation & Setup

```bash
npm install -g agent-validator
agent-validator init
```

`init` detects your installed AI CLIs, creates `.validator/config.yml` with an empty config skeleton, and installs skills/hooks for your AI agent (Claude Code plugin, Copilot plugin, Cursor plugin, or Codex skills). Use `--yes` to skip prompts.

After init, run `/validator-setup` in your AI agent session to auto-discover your project's tooling and populate the config. See the [Skills Guide](docs/skills-guide.md) for details.

### Configuration Concepts

Agent Validator uses three core concepts:

- **Entry points**: Paths in your repository (e.g., `src/`) that Agent Validator monitors for changes.
- **Checks**: Shell commands that run when an entry point changes — things like tests, linters, and type-checkers.
- **Reviews**: AI-powered code reviews requested via CLI tools like Codex, Claude, or Gemini.

When you run Agent Validator, it detects which entry points have changed files and runs the associated checks and reviews.

### Example Configuration

Checks and reviews are defined inline in `config.yml`. Here's a simplified real-world example:

```yaml
base_branch: main
log_dir: validator_logs
allow_parallel: true

cli:
  adapters:
    github-copilot:
      allow_tool_use: false
      thinking_budget: low

entry_points:
  - path: "."
    exclude:
      - .validator
      - openspec
    checks:
      - build:
          command: bun run build
      - lint:
          command: bunx biome check src
      - typecheck:
          command: bun run typecheck
      - test:
          command: bun test
      - security-code:
          command: semgrep scan --config auto --error src
    reviews:
      - code-quality:
          builtin: code-quality
          cli_preference:
            - github-copilot
          model: claude-sonnet-4.6
      - security-and-errors:
          builtin: security-and-errors
          cli_preference:
            - github-copilot
          model: gpt-5.3-codex
```

- **Checks** are inline shell commands — pass/fail based on exit code
- **Reviews** reference a `builtin` prompt or a custom `.validator/reviews/*.md` file
- Entry points can share gate names — define a gate inline once, reference it by name elsewhere

For check/review file definitions, per-review settings, and the full configuration schema, see the [Configuration Reference](docs/config-reference.md) and [User Guide](docs/user-guide.md).

### Agent Skills

Agent Validator installs as a plugin for Claude Code, GitHub Copilot, and Cursor (and copies skill files for Codex), giving you slash-command workflows directly in your AI agent session. See the [Skills Guide](docs/skills-guide.md) for the full list.

### Recommended Reviewer Configuration

> Based on [eval benchmarks](docs/eval-report-2026-04-05.md) across code-quality, security, and error-handling prompts.

**Built-in review prompts available:**

| Builtin | Covers | Best with |
|---------|--------|-----------|
| `code-quality` | Bugs, logic errors, style | Sonnet (separate) |
| `security` | Auth, injection, data exposure | Sonnet (separate) |
| `error-handling` | Missing error handling, silent failures | Sonnet (separate) |
| `security-and-errors` | Security + error-handling combined | GPT (combined) |
| `all-reviewers` | All of the above in one pass | GPT (combined) |

**Primary recommendation (GitHub Copilot available):** Two-pass hybrid — Sonnet for code quality, GPT for security + error-handling combined. Best price/performance ratio.

```yaml
# .validator/config.yml
cli:
  default_preference:
    - github-copilot
    - codex
  adapters:
    github-copilot:
      allow_tool_use: false
      thinking_budget: low        # optimal for Sonnet; keeps runtime ~105s
    codex:
      allow_tool_use: false
      thinking_budget: medium     # helps GPT on security/error-handling tasks

reviews:
  code-quality:
    builtin: code-quality
    cli_preference: [github-copilot]
    model: claude-sonnet-4.6     # 0.71 recall, 0.87 precision
  security-and-errors:
    builtin: security-and-errors
    cli_preference: [github-copilot]
    model: gpt-5.3-codex         # 0.79 recall in single combined pass (~73s)
```

**Secondary recommendation (no Copilot, Codex only):** Single combined pass across all review types.

```yaml
# .validator/config.yml
cli:
  default_preference:
    - codex
  adapters:
    codex:
      allow_tool_use: false
      thinking_budget: medium

reviews:
  all-reviewers:
    builtin: all-reviewers
    model: gpt-5.3-codex         # 0.69 recall, 0.96 precision across all 56 issues (~82s)
```

> **Note:** Do not use the `claude` (Claude Code CLI) adapter for reviews — it has significantly higher overhead than `github-copilot` and will timeout on most review prompts. Use `github-copilot` with `model: claude-sonnet-4.6` to run Sonnet reviews.

### Logs

Each job writes a log file under `log_dir` (default: `validator_logs/`). Filenames are derived from the job id (sanitized).

### CI Setup (Optional)

To run your checks in GitHub Actions:

```bash
agent-validator ci init
```

This creates:
- `.validator/ci.yml` — CI-specific configuration (services, runtimes, setup steps)
- `.github/workflows/Agent Validator.yml` — GitHub Actions workflow file

Your local check definitions (`.validator/checks/`) are automatically used in CI. The `ci.yml` file lets you configure additional CI-specific settings like database services or runtime versions.

### Updating

To update Agent Validator after upgrading the npm package:

```bash
agent-validator update
```

This updates the Claude Code plugin (via marketplace), the GitHub Copilot plugin (via `gh copilot -- plugin install`), refreshes the Cursor plugin (via file copy) if installed, and refreshes Codex skills if installed. The command auto-detects where each plugin is installed.

### Execution State & Skipping

Agent Validator tracks an **execution state baseline** — the branch, commit, and working tree snapshot at which the last run completed. On subsequent runs, only changes since that baseline are reviewed, avoiding redundant and expensive re-reviews of code that already passed. When a run fails, the baseline stays put so the next run can verify fixes in a narrowed scope. If you want to advance the baseline without running reviews — for example, after manually reviewing changes, accepting flagged issues, or integrating upstream code — run `agent-validator skip` to record the current state as the new starting point. See [Execution State Tracking](docs/execution-state.md) for full details on how state is managed, when it resets, and edge cases.

## Documentation

- [User Guide](docs/user-guide.md) — full usage details
- [Configuration Reference](docs/config-reference.md) — all configuration fields + defaults
- [Execution State Tracking](docs/execution-state.md) — how the validator avoids redundant reviews
- [Plugin & Update Guide](docs/plugin-guide.md) — Claude Code and Cursor plugin delivery and updating
- [CLI Invocation Details](docs/cli-invocation-details.md) — how we securely invoke AI CLIs
- [Feature Comparison](docs/feature_comparison.md) — how Agent Validator compares to other tools
- [Development Guide](docs/development.md) — how to build and develop this project
