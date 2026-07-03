---
title: Quickstart
group: Getting Started
order: 2
description: Install Agent Validator and configure the first project.
---

# Quickstart

## Requirements

- Node.js 18 or newer
- Git
- Bun for local development from source
- Optional review CLIs: `claude`, `codex`, `gemini`, `copilot`, `cursor`, or `opencode`

## Install

```bash
npm install -g agent-validator
agent-validate --help
```

## Initialize A Project

Run init from the root of the repository you want to validate:

```bash
agent-validate init
```

Init performs these tasks:

- Detects installed agent CLIs.
- Asks which development agents should receive plugins or skills.
- Asks which review CLIs should be used for AI reviews.
- Creates `.validator/config.yml` when `.validator/` does not already exist.
- Installs or updates agent plugins and skills through `agent-plugin`.
- Prints next-step instructions.

For non-interactive defaults:

```bash
agent-validate init --yes
```

To preselect development agents:

```bash
agent-validate init --agents claude codex
```

To scaffold an opt-in built-in review:

```bash
agent-validate init --enable-builtin task-compliance
```

## Configure Checks

After init, invoke `/validator-setup` from your coding agent. The setup skill reads project files, detects tool commands, and updates `.validator/config.yml`.

You can also edit config manually. See [Configuring Gates](configuring-gates.md) and [Configuration Reference](config-reference.md).

## Run Validation

Run all applicable checks and reviews:

```bash
agent-validate run
```

Run checks only:

```bash
agent-validate check
```

Preview what would run:

```bash
agent-validate detect
```

When a run fails, fix the reported issues and run the same command again. Existing logs put the next run into verification mode.
