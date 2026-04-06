![Agent Validator logo](docs/images/agent-validator-logo.png)

[![CI](https://github.com/Codagent-AI/agent-validator/actions/workflows/validator.yml/badge.svg)](https://github.com/Codagent-AI/agent-validator/actions/workflows/validator.yml)
[![npm](https://img.shields.io/npm/v/agent-validator)](https://www.npmjs.com/package/agent-validator)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![OpenSpec](https://raw.githubusercontent.com/Codagent-AI/agent-validator/gh-pages/badges/number_of_specs.svg)](https://github.com/Codagent-AI/agent-validator)
<!-- [![npm downloads](https://img.shields.io/npm/dm/agent-validator)](https://www.npmjs.com/package/agent-validator) -->
<!-- [![CodeRabbit](https://img.shields.io/coderabbit/prs/github/Codagent-AI/agent-validator)](https://coderabbit.ai) -->

> Don't just review the agent's code — put it through the validator.

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

## Common Workflows

Agent Validator supports three workflows, ranging from simple CLI execution to fully autonomous agentic integration:

- **CLI Mode** — Run checks via command line; ideal for CI pipelines and scripts.
- **Assistant Mode** — AI assistant runs validation loop, fixing issues iteratively.
- **Agentic Mode** — Autonomous agent validates and fixes in real-time, delivered as a Claude Code or Cursor plugin. *(Coming soon with [Agent Runner](https://www.codagent.dev/).)*

![Agent Validator Workflows](docs/images/workflows2.png)

### Comparison vs Other Tools

### AI Code Review Tools

Agent Validator is not a replacement for tools that provide AI pull request code reviews. It provides real-time feedback loops for autonomous coding agents, combining deterministic static checks (build, lint, test) with multi-agent AI reviews in a single pipeline. This enables agents to iterate and self-correct until all checks and reviews pass, without human intervention.

[Full comparison →](docs/feature_comparison.md)

### Spec-Driven Workflow Tools

It is recommended to use Agent Validator in conjunction with other spec-driven development tools. We believe is the ideal implementation of the validation step in any Spec → Implement → Validate workflow.

## Quick Start

### Requirements

- **Node.js** (v18.0.0+)
- **git** (change detection and diffs)
- For reviews: one or more supported AI CLIs installed (`gemini`, `codex`, `claude`, `github-copilot`, `cursor`). For the full list of tools and how they are used, see [CLI Invocation Details](docs/cli-invocation-details.md)

### Installation

```bash
npm install -g agent-validator
```

### Initialization

Initialize configuration in your project root:

```bash
agent-validator init
```

This walks you through an interactive setup:

1. **Detects available CLIs** on your system
2. **Prompts for development CLIs** — the tools you work in
3. **Prompts for install scope** — local (project) or global (user) installation
4. **Prompts for review CLIs** — the tools used for AI code reviews (sets `cli.default_preference`)
5. **Creates `.validator/`** with a config skeleton and the built-in code-quality review (see [Configuration Layout](#configuration-layout))
6. **Installs skills and hooks** — for Claude Code, installs as a Claude Code plugin (skills and hooks delivered via plugin). For GitHub Copilot, installs via `gh copilot -- plugin install` (discovers the same `.claude-plugin/` manifest). For Cursor, installs by copying plugin files (`.cursor-plugin/`, skills, hooks) to `.cursor/plugins/agent-validator/` or `~/.cursor/plugins/agent-validator/`. For Codex, copies skill files to `.agents/skills/`.
7. **Prints next steps** with context-aware instructions for your selected CLIs (Claude Code, Cursor, and GitHub Copilot users get `/validator-setup` instructions)

Use `--yes` to skip all prompts (selects all detected CLIs, overwrites changed files).

After init, configure your checks and reviews by running the setup skill in your AI agent session:

```
/validator-setup
```

The setup skill scans your project, discovers available tooling (linters, test runners, type checkers, etc.), and configures checks and entry points in `.validator/config.yml`. See the [Skills Guide](docs/skills-guide.md) for details.

### Configuration Concepts

Agent Validator uses three core concepts:

- **Entry points**: Paths in your repository (e.g., `src/`, `docs/plans/`) that Agent Validator monitors for changes.
- **Checks**: Shell commands that run when an entry point changes — things like tests, linters, and type-checkers.
- **Reviews**: AI-powered code reviews requested via CLI tools like Codex, Claude, or Gemini. Each review uses a custom prompt you define.

When you run `agent-validator`, it detects which entry points have changed files and runs the associated checks and reviews.

### Basic Usage

- **Run gates for detected changes**

```bash
agent-validator run
```

- **Run gates from your agent and auto-fix detected issues**

```
/validator-run
```

### Agent Skills

Agent Validator installs as a plugin for Claude Code, GitHub Copilot, and Cursor (and copies skill files for Codex), giving you slash-command workflows directly in your AI agent session. For example, `/validator-help` provides guidance and troubleshooting on how to use the tool. See the [Skills Guide](docs/skills-guide.md) for the full list of skills and configuration options.

### Configuration Layout

Agent Validator loads configuration from your repository:

```text
.validator/
  config.yml          # entry_points starts as [] after init
  checks/             # populated by /validator-setup or manually
  reviews/
    code-quality      # created by init
```

- **Project config**: `.validator/config.yml`
- **Check definitions**: `.validator/checks/`
- **Review definitions**: `.validator/reviews/`

### Example Configuration

After running `agent-validator init`, your `config.yml` starts with empty entry points:

```yaml
base_branch: origin/main
log_dir: validator_logs
cli:
  default_preference:
    - claude
    - gemini
# entry_points configured by /validator-setup
entry_points: []
```

After running `/validator-setup`, a real-world configuration might look like this:

#### config.yml

```yaml
base_branch: origin/main
log_dir: validator_logs
allow_parallel: true
cli:
  default_preference:
    - codex
    - claude
    - gemini
entry_points:
  - path: "src"
    checks:
      - test
      - lint
      - security-code
    reviews:
      - code-quality
  - path: "package.json"
    checks:
      - security-deps
  - path: "internal-docs/plans"
    reviews:
      - plan-review
```

**What each section does:**

| Section | Purpose |
|---------|---------|
| `base_branch` | The branch to compare against when detecting changes (usually `origin/main`) |
| `log_dir` | Where Agent Validator writes log files for each run |
| `allow_parallel` | Run checks and reviews concurrently for faster feedback |
| `cli.default_preference` | Ordered list of AI CLIs to try for reviews — uses the first available one |
| `entry_points` | Maps paths to the checks and reviews that run when those paths change |

In this example:
- Changes to `src/` trigger tests, linting, security checks, **and** an AI code review
- Changes to `package.json` trigger a dependency security audit
- Changes to `internal-docs/plans/` trigger an AI plan review (no code checks needed)

#### Check definition example

Checks are shell commands defined in `.validator/checks/`:

```yaml
# .validator/checks/lint.yml
name: lint
command: bunx biome check src
working_directory: .
run_in_ci: true
run_locally: true
```

The check name (`lint`) is referenced in `config.yml`. When Agent Validator runs this check, it executes the `command` and reports pass/fail based on exit code.

#### Review definition example

Reviews are defined in `.validator/reviews/`:

```yaml
# .validator/reviews/code-quality.yml
builtin: code-quality
num_reviews: 1
```

Review definitions can be **YAML** (`.yml`) or **Markdown** (`.md`). The filename (minus extension) becomes the review name referenced in `config.yml`.

**Built-in reviews** use YAML with a `builtin` key that references a review prompt shipped with Agent Validator. The built-in `code-quality` review is a general-purpose code review that checks for bugs, style issues, and best practices. `num_reviews` controls how many review passes to run.

**Custom reviews** are Markdown files containing your own review prompt. Agent Validator passes the prompt — along with the diff of changed files — to the AI CLI:

```markdown
<!-- .validator/reviews/plan-review.md -->

# Plan Review
Review this plan for completeness and potential issues.
```

**Per-review settings:** Both YAML and Markdown reviews support optional frontmatter to override defaults like `cli_preference`. This is useful when you want a specific LLM for certain types of reviews — for example, using Gemini for plan reviews but Codex for code reviews:

```markdown
---
cli_preference:
  - gemini
  - codex
---

# Plan Review
Review this plan for completeness and potential issues.
```

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
