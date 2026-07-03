# Agent Validator

![Agent Validator logo](docs/images/agent-validator-logo.png)

[![CI](https://github.com/Codagent-AI/agent-validator/actions/workflows/validator.yml/badge.svg)](https://github.com/Codagent-AI/agent-validator/actions/workflows/validator.yml)
[![npm](https://img.shields.io/npm/v/agent-validator)](https://www.npmjs.com/package/agent-validator)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![OpenSpec](https://raw.githubusercontent.com/Codagent-AI/agent-validator/gh-pages/badges/number_of_specs.svg)](https://github.com/Codagent-AI/agent-validator)

Agent Validator is a configurable feedback runner for AI-assisted development workflows. It runs the checks and AI reviews that apply to the files that changed, records structured runtime state, and supports agent skills that can fix and rerun failures until validation passes.

Use it when you want an agent to work inside an external validation loop: build, lint, test, review, fix, rerun.

![Agent Validator Demo](docs/images/agent-validator-demo.gif)

## Quick Start

Requirements:

- Node.js 18 or newer
- Git
- Optional review CLIs: Claude Code, Codex, Gemini, GitHub Copilot, Cursor, or OpenCode

Install and initialize:

```bash
npm install -g agent-validator
agent-validate init
```

`agent-validator` is also installed as an alias, but the CLI help and generated docs use `agent-validate`.

After init, run `/validator-setup` from your coding agent to discover project tooling and write the first checks into `.validator/config.yml`.

## What It Does

- Runs deterministic check gates such as build, lint, typecheck, test, and security scanners.
- Runs AI review gates through local CLI adapters, using your existing tool subscriptions.
- Matches changed files to configured entry points so unrelated parts of a repo do not run unnecessary gates.
- Supports disabled opt-in reviews such as `task-compliance`, activated with `--enable-review`.
- Tracks execution state and trusted snapshots so reruns verify fixes without repeatedly reviewing already validated work.
- Installs agent skills and plugins so agents can run, diagnose, skip, and commit with validator-aware workflows.

## Minimal Config

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
      - test:
          command: npm test
      - lint:
          command: npm run lint
    reviews:
      - all-reviewers:
          builtin: all-reviewers
          cli_preference:
            - codex
          model: gpt-5.3-codex
```

Inline checks and reviews are defined inside `entry_points`. File-based gates are also supported under `.validator/checks/` and `.validator/reviews/`.

## Documentation

- [Documentation Index](docs/README.md)
- [Introduction](docs/introduction.md)
- [Quickstart](docs/quickstart.md)
- [Setup](docs/setup.md)
- [Configuring Gates](docs/configuring-gates.md)
- [CLI Reference](docs/cli-reference.md)
- [Running Validation](docs/running-validation.md)
- [Execution State](docs/execution-state.md)
- [Trusted Snapshots](docs/trusted-snapshots.md)
- [Reviews and Adapters](docs/reviews-and-adapters.md)
- [Skills and Plugins](docs/skills-and-plugins.md)
- [CI Integration](docs/ci.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Configuration Reference](docs/config-reference.md)
- [Development](docs/development.md)
