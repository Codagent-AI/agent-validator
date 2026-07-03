---
title: Plugin Guide
group: Reference
order: 5
description: Plugin install and update details.
---

# Plugin Guide

Agent Validator installs agent integrations during `agent-validate init`. The current install path delegates deterministic plugin and skill operations to `agent-plugin`.

## Install Flow

During init, Agent Validator:

1. detects available agent CLIs
2. asks which development agents should receive integrations
3. asks for project or user install scope
4. runs an `agent-plugin` dry run
5. asks for confirmation unless `--yes` was passed
6. installs the Agent Validator plugin and skills for selected agents

Non-interactive examples:

```bash
agent-validate init --yes
agent-validate init --agents claude codex
```

## Install Scope

| Scope | Meaning |
| --- | --- |
| Project | Installs into the current repository's agent configuration directories |
| User | Installs into user-level agent configuration directories |

Project scope passes `--project` to `agent-plugin`. User scope omits it.

## Supported Integrations

| Agent | Integration |
| --- | --- |
| Claude Code | Plugin |
| GitHub Copilot | Standalone Copilot plugin |
| Cursor | Cursor plugin assets |
| Codex | Skill files in `.agents/skills` or user skill directory |
| Gemini | Command or skill directory when supported by the adapter |

The distributable source of truth for skills is the repository `skills/` directory.

## Updating

After upgrading the npm package, refresh installed integrations:

```bash
agent-validate update
```

The update command:

- detects installed Claude, Copilot, Cursor, Codex, and other supported integrations
- delegates plugin refreshes to the adapter or `agent-plugin update Codagent-AI/agent-validator`
- updates project scope when both project and user scope are installed and the project integration is closest
- reports an error if no Agent Validator integration is installed

Re-running `agent-validate init` when `.validator/` already exists delegates to the same update flow. If no plugin is installed yet, init falls back to a fresh install path.

## Manual Recovery

If plugin installation fails, rerun with validation first:

```bash
agent-validate validate
agent-validate init
```

If update fails because no integration is installed:

```bash
agent-validate init
```

If a specific adapter reports missing or unhealthy, inspect:

```bash
agent-validate health
```
