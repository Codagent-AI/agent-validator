---
title: Setup
group: Getting Started
order: 3
description: Set up Agent Validator in a Git project and run the first validation loop.
---

# Setup

Use this guide when you want to configure Agent Validator in a real project. For a shorter install-only path, see the [Quickstart](quickstart.md).

## Prerequisites

- Node.js 18 or newer
- Git

Agent Validator uses Git to detect changed files, compute diffs, store trusted snapshots, and decide which gates should run.

## Initialize Git Repo

Start from a real project directory that has already been initialized as a Git repository. Agent Validator should be configured after the initial project files exist and the repository has an initial baseline commit.

If the directory is empty or is not a Git repository yet, initialize the repository before continuing. The exact commands depend on the project and Git workflow, so use the normal setup path for that project.

## Install

Install the npm package globally:

```bash
npm install -g agent-validator
agent-validate --help
```

The package installs `agent-validate` as the primary CLI and `agent-validator` as a compatibility alias.

## Initialize Agent Validator

Run init from the project root:

```bash
agent-validate init
```

Init detects installed agent CLIs, asks which development agents should receive plugins or skills, asks which review CLIs should be used, creates `.validator/config.yml` when needed, and installs agent integrations through `agent-plugin`.

## Configure Gates

After init, open your coding agent in the same project and run:

```text
/validator-setup
```

The setup skill inspects the project, finds likely build, lint, test, and review commands, and updates `.validator/config.yml`.

If you want AI review gates, install and authenticate the review CLIs you plan to use before configuring those reviews. Supported review CLIs include `claude`, `codex`, `gemini`, `copilot`, `cursor`, and `opencode`.

Review the generated config before relying on it:

```bash
agent-validate list
agent-validate detect
```

If you prefer manual configuration, see [Configuring Gates](configuring-gates.md) and [Configuration Reference](config-reference.md).

## Run The First Validation

Make or keep a small change in the working tree, then ask your coding agent to run validation with the installed skills.

For the full validation loop, including checks, reviews, and fix iterations:

```text
/validator-run
```

For deterministic checks only:

```text
/validator-check
```

If you intentionally want to advance the validation baseline without running gates, use the skip skill and give the agent the reason:

```text
/validator-skip
```

Use skip only when you have explicitly decided the current changes do not need validation, such as after reviewing generated docs-only changes or after an external validation path already covered the work.

To diagnose what happened in a validation run, ask the agent to inspect validator logs and explain the result:

```text
/validator-help
```

You can still run the CLI directly when you do not want agent help:

```bash
agent-validate run
```

When validation fails, fix the reported issues and run the same command again. Agent Validator writes logs and execution state so reruns verify the fixes instead of treating every run as a fresh review.

## Next Steps

- Read [Running Validation](running-validation.md) for run, check, review, detect, and rerun behavior.
- Read [Skills and Plugins](skills-and-plugins.md) for the installed agent skills.
- Read [Execution State](execution-state.md) for baselines, verification mode, skip, and trusted snapshots.
