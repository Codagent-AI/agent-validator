---
title: Skills and Plugins
group: Usage
order: 3
description: Agent-facing skills and plugin delivery.
---

# Skills and Plugins

Agent Validator ships agent-facing skills under the repository `skills/` directory. `agent-validate init` installs those skills and related plugin assets through `agent-plugin` for the development agents selected during setup.

## Installed Skills

| Skill | Purpose |
| --- | --- |
| `/validator-setup` | Scan a project and configure checks/reviews |
| `/validator-run` | Run full validation and iterate on failures |
| `/validator-check` | Run checks-only validation |
| `/validator-status` | Summarize the latest validator session |
| `/validator-help` | Diagnose validator behavior from runtime evidence |
| `/validator-commit` | Detect, validate or skip, then commit |
| `/validator-issue` | Draft and optionally file agent-validator bug reports |
| `/validator-skip` | Advance the baseline without running gates after explicit confirmation |

The source of truth for distributable skill contents is the root `skills/` directory.

## Plugin Delivery

Agent Validator delegates plugin and skill installation to `agent-plugin`.

| Agent | Delivery |
| --- | --- |
| Claude Code | Claude plugin |
| GitHub Copilot | Copilot plugin |
| Cursor | Cursor plugin assets |
| Codex | Skills under `.agents/skills` or user skill directory |
| Gemini | Command/skill directory through the adapter when supported |

Project scope installs into the current repository. User scope installs into the user's agent configuration directories.

## Updating

After upgrading the npm package, refresh installed integrations:

```bash
agent-validate update
```

The update command detects installed integrations and delegates refreshes to the adapter or `agent-plugin` path. If no integration is found, it reports that `agent-validate init` should be run first.

## Skill Behavior

Validator skills are intentionally explicit:

- `/validator-run` is for full validation requests.
- `/validator-check` is for checks-only requests.
- `/validator-commit` is only for commit requests that explicitly mention validation, checks, gauntlet, or skip behavior.
- `/validator-skip` requires explicit skip confirmation before advancing state.

See [Skills Guide](skills-guide.md) for skill-level details.
