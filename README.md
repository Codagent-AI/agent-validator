![Agent Gauntlet logo](docs/images/logo2.png)

[![CI](https://github.com/pacaplan/agent-gauntlet/actions/workflows/gauntlet.yml/badge.svg)](https://github.com/pacaplan/agent-gauntlet/actions/workflows/gauntlet.yml)
[![npm](https://img.shields.io/npm/v/agent-gauntlet)](https://www.npmjs.com/package/agent-gauntlet)
[![npm downloads](https://img.shields.io/npm/dm/agent-gauntlet)](https://www.npmjs.com/package/agent-gauntlet)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![CodeRabbit](https://img.shields.io/coderabbit/prs/github/pacaplan/agent-gauntlet)](https://coderabbit.ai)

> Don't just review the agent's code — put it through the gauntlet.

Agent Gauntlet is a configurable “feedback loop” runner for AI-assisted development workflows.

You configure which paths in your repo should trigger which validations — shell commands like tests and linters, plus AI-powered code reviews. When files change, Gauntlet automatically runs the relevant validations and reports results.

For AI reviews, it uses the CLI tool of your choice: Gemini, Codex, Claude Code, GitHub Copilot, or Cursor. 

## Features

- **Agent validation loop**: Keep your coding agent on track with automated feedback loops. Detect problems — deterministically and/or non-deterministically — and let your agent fix and Gauntlet verify.
- **Multi-agent collaboration**: Enable one AI agent to automatically request code reviews from another. For example, if Claude made changes, Gauntlet can request a review from Codex or Gemini — spreading token usage across your subscriptions instead of burning through one.
- **Leverage existing subscriptions**: Agent Gauntlet is *free* and tool-agnostic, leveraging the AI CLI tools you already have installed.
- **Easy CI setup**: Define your checks once, run them locally and in GitHub.

### vs AI Code Review Tools

Unlike traditional code review tools designed for PR workflows, Agent Gauntlet provides real-time feedback loops for autonomous coding agents.

| Use Case | Recommended |
| :--- | :--- |
| Autonomous agent development | **Agent Gauntlet** |
| Traditional PR review with human reviewers | Other tools |
| IDE-integrated review while coding | Other tools |
| Enterprise with strict compliance requirements | Other tools |
| Budget-conscious teams with existing AI CLI tools | **Agent Gauntlet** |

[Full comparison →](docs/feature_comparison.md)

## Common Workflows

Agent Gauntlet supports three workflows, ranging from simple CLI execution to fully autonomous agentic integration:

- **CLI Mode** — Run checks via command line; ideal for CI pipelines and scripts.
- **Assistant Mode** — AI assistant runs validation loop, fixing issues iteratively.
- **Agentic Mode** — Autonomous agent validates and fixes in real-time via stop hook.

![Agent Gauntlet Workflows](docs/images/workflows.png)

## Quick Start

1. **Install**: `bun add -g agent-gauntlet`
2. **Initialize**: `agent-gauntlet init`
3. **Run**: `agent-gauntlet run`

For basic usage and configuration guide, see the [Quick Start Guide](docs/quick-start.md).

## Documentation

- [Quick Start Guide](docs/quick-start.md) — installation, basic usage, and config layout
- [User Guide](docs/user-guide.md) — full usage details
- [Configuration Reference](docs/config-reference.md) — all configuration fields + defaults
- [Stop Hook Guide](docs/stop-hook-guide.md) — integrate with Claude Code's stop hook
- [CLI Invocation Details](docs/cli-invocation-details.md) — how we securely invoke AI CLIs
- [Feature Comparison](docs/feature_comparison.md) — how Agent Gauntlet compares to other tools
- [Development Guide](docs/development.md) — how to build and develop this project
