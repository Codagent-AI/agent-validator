---
title: Running Validation
group: Usage
order: 1
description: Run checks, reviews, dry-run detection, reports, and verification reruns.
---

# Running Validation

## Main Commands

| Command | Purpose |
| --- | --- |
| `agent-validate run` | Run applicable checks and reviews |
| `agent-validate check` | Run applicable checks only |
| `agent-validate review` | Run applicable reviews only |
| `agent-validate detect` | Show changed files and gates without executing them |
| `agent-validate list` | Print configured gates and entry points |
| `agent-validate health` | Validate config and check review CLI availability |

## Change Detection

Local runs include:

- committed changes against `base_branch`
- staged and unstaged changes
- untracked files that are not ignored by Git

CI runs are detected through `CI=true` or `GITHUB_ACTIONS=true`. In CI, Agent Validator uses the GitHub base/head refs when available, otherwise it falls back to a single-commit diff.

## Common Flags

The `run`, `check`, `review`, and `detect` commands support change-selection flags:

| Flag | Meaning |
| --- | --- |
| `--base-branch <branch>` | Override configured base branch |
| `--commit <sha>` | Use the diff for a specific commit |
| `--uncommitted` | Use staged, unstaged, and untracked changes only |

`run` and `review` also support review-specific flags:

| Flag | Meaning |
| --- | --- |
| `--enable-review <name>` | Activate a configured disabled review for this run; repeatable |
| `--context-file <path>` | Replace `{{CONTEXT}}` in review prompts with file contents |

`run` also supports:

| Flag | Meaning |
| --- | --- |
| `--gate <name>` | Run one gate by name |
| `--report` | Write a plain-text failure report to stdout and `<log_dir>/report.txt` |

## Verification Reruns

When `run`, `check`, or `review` find existing log files in `log_dir`, they enter verification mode:

- prior failures are parsed from the latest numbered logs
- the diff is scoped to the current fix work
- one-shot reviews can preserve prior violation state instead of dispatching again
- passed review slots can be skipped on multi-adapter reruns

Do not run `clean` between a failed run and its verification rerun unless you intentionally want to reset the active log session.

## Failure Reports

Use `--report` when another orchestrator needs a stable text summary:

```bash
agent-validate run --report
```

The report includes:

- a `Status:` line
- check failures with command, working directory, fix instructions, and log path
- review violations with stable numeric IDs and JSON file paths

Use `agent-validate update-review` to mark reported review violations as fixed or skipped before rerunning.

## Status Values

| Status | Meaning |
| --- | --- |
| `Passed` | All gates passed |
| `Passed with warnings` | Gates passed but skipped review violations remain |
| `Failed` | At least one gate failed and retries remain |
| `Retry limit exceeded` | The configured retry limit has been reached |
| `trusted` | Current clean `HEAD` matched a trusted snapshot |
