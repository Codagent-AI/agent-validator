![Agent Gauntlet logo](docs/images/logo2.png)

[![CI](https://github.com/pacaplan/agent-gauntlet/actions/workflows/gauntlet.yml/badge.svg)](https://github.com/pacaplan/agent-gauntlet/actions/workflows/gauntlet.yml)
[![npm](https://img.shields.io/npm/v/agent-gauntlet)](https://www.npmjs.com/package/agent-gauntlet)
[![npm downloads](https://img.shields.io/npm/dm/agent-gauntlet)](https://www.npmjs.com/package/agent-gauntlet)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CodeRabbit](https://img.shields.io/coderabbit/prs/github/pacaplan/agent-gauntlet)](https://coderabbit.ai)

> Don't just review the agent's code — put it through the gauntlet.

Agent Gauntlet is a configurable “feedback loop” runner for AI-assisted development workflows.

You configure which paths in your repo should trigger which validations — shell commands like tests and linters, plus AI-powered local code reviews. When files change, Gauntlet automatically runs the relevant validations and reports results.

For AI reviews, it uses the CLI tool of your choice: Gemini, Codex, Claude Code, GitHub Copilot, or Cursor. 

## Features

- **Agent validation loop**: Keep your coding agent on track with automated feedback loops. Detect problems — deterministically and/or non-deterministically — and let your agent fix and Gauntlet verify.
- **Local cross-agent code reviews**: Enable one AI agent to automatically request code reviews from another. For example, if Claude made changes, Gauntlet can request a review from Codex — spreading token usage across your subscriptions instead of burning through one.
  - Multiple AI review adapters have been evaluated for quality and efficiency. Claude and Codex deliver optimal review quality with superior token efficiency. For detailed metrics, see [Eval Results](docs/eval-results.md).
- **Leverage existing subscriptions**: Agent Gauntlet is *free* and tool-agnostic, leveraging the AI CLI tools you already have installed.
- **Easy CI setup**: Define your CI gates once, run them locally and in GitHub.

## Common Workflows

Agent Gauntlet supports three workflows, ranging from simple CLI execution to fully autonomous agentic integration:

- **CLI Mode** — Run checks via command line; ideal for CI pipelines and scripts.
- **Assistant Mode** — AI assistant runs validation loop, fixing issues iteratively.
- **Agentic Mode** — Autonomous agent validates and fixes in real-time via stop hook (experimental).

![Agent Gauntlet Workflows](docs/images/workflows.png)

### Example Workflow

1. Claude implements a feature
2. Agent Gauntlet reports quality issues detected by static code analysis and Codex reviewer agent
3. Claude fixes issues
4. Agent Gauntlet verifies

### Comparison vs Other Tools

### AI Code Review Tools

Agent Gauntlet is not a replacement for tools that provide AI pull request code reviews. It provides real-time feedback loops for autonomous coding agents, combining deterministic static checks (build, lint, test) with multi-agent AI reviews in a single pipeline. This enables agents to iterate and self-correct until all checks and reviews pass, without human intervention.

[Full comparison →](docs/feature_comparison.md)

### Spec-Driven Workflow Tools

It is recommended to use Agent Gauntlet in conjunction with other spec-driven development tools. We believe is the ideal implementation of the validation step in any Spec → Implement → Validate workflow.

## Quick Start

For basic usage and configuration guide, see the [Quick Start Guide](docs/quick-start.md).

## Documentation

- [Quick Start Guide](docs/quick-start.md) — installation, basic usage, and config layout
- [User Guide](docs/user-guide.md) — full usage details
- [Configuration Reference](docs/config-reference.md) — all configuration fields + defaults
- [Stop Hook Guide](docs/stop-hook-guide.md) — integrate with Claude Code's stop hook (experimental).
- [CLI Invocation Details](docs/cli-invocation-details.md) — how we securely invoke AI CLIs
- [Feature Comparison](docs/feature_comparison.md) — how Agent Gauntlet compares to other tools
- [Development Guide](docs/development.md) — how to build and develop this project
