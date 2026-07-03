---
title: CLI Reference
group: Reference
order: 1
description: Command reference generated from live Agent Validator help output.
---

# CLI Reference

<!-- Generated from `bun src/index.ts --help` and subcommand help on 2026-07-02. -->

## `agent-validate`

```text
Usage: agent-validate [options] [command]

AI-assisted quality gates

Options:
  -V, --version           output the version number
  -h, --help              display help for command

Commands:
  run [options]           Run gates for detected changes
  check [options]         Run only applicable checks for detected changes
  ci                      Manage CI integration
  clean                   Archive logs
  demo                    Scaffold a demo project in a temp directory
  review-audit [options]  Audit review execution from the debug log (--date or
                          --since)
  review [options]        Run only applicable reviews for detected changes
  detect [options]        Show what gates would run for detected changes
                          (without executing them)
  list                    List configured gates
  health                  Check CLI tool availability
  init [options]          Initialize .validator configuration
  update                  Update the agent-validator Claude plugin and refresh
                          skills
  update-review           Manage review violations
  validate                Validate config files against schemas
  skip                    Advance execution state baseline without running gates
  status                  Show a summary of the most recent validator session
  help                    Show help information
```

## `agent-validate run`

```text
Usage: agent-validate run [options]

Run gates for detected changes

Options:
  -b, --base-branch <branch>  Override base branch for change detection
  -g, --gate <name>           Run specific gate only
  -c, --commit <sha>          Use diff for a specific commit
  -u, --uncommitted           Use diff for current uncommitted changes (staged
                              and unstaged)
  -e, --enable-review <name>  Activate a disabled review for this run
                              (repeatable) (default: [])
  --context-file <path>       Inject file contents into review prompts via
                              {{CONTEXT}} placeholder
  --report                    Write a structured failure report to stdout
  -h, --help                  display help for command
```

## `agent-validate check`

```text
Usage: agent-validate check [options]

Run only applicable checks for detected changes

Options:
  -b, --base-branch <branch>  Override base branch for change detection
  -g, --gate <name>           Run specific check gate only
  -c, --commit <sha>          Use diff for a specific commit
  -u, --uncommitted           Use diff for current uncommitted changes (staged
                              and unstaged)
  -h, --help                  display help for command
```

## `agent-validate review`

```text
Usage: agent-validate review [options]

Run only applicable reviews for detected changes

Options:
  -b, --base-branch <branch>  Override base branch for change detection
  -g, --gate <name>           Run specific review gate only
  -c, --commit <sha>          Use diff for a specific commit
  -u, --uncommitted           Use diff for current uncommitted changes (staged
                              and unstaged)
  -e, --enable-review <name>  Activate a disabled review for this run
                              (repeatable) (default: [])
  --context-file <path>       Inject file contents into review prompts via
                              {{CONTEXT}} placeholder
  -h, --help                  display help for command
```

## `agent-validate detect`

```text
Usage: agent-validate detect [options]

Show what gates would run for detected changes (without executing them)

Options:
  -b, --base-branch <branch>  Override base branch for change detection
  -c, --commit <sha>          Use diff for a specific commit
  -u, --uncommitted           Use diff for current uncommitted changes (staged
                              and unstaged)
  -h, --help                  display help for command
```

## Setup And Maintenance Commands

```text
Usage: agent-validate init [options]

Initialize .validator configuration

Options:
  -y, --yes                    Skip prompts and use defaults
  --agents <names...>          Development/coding agent names to install for
                               (comma or space separated); skips the development
                               agent prompt
  --enable-builtin <names...>  Built-in opt-in review names to scaffold with
                               enabled: false (comma or space separated). Names
                               must be opt-in built-ins.
  -h, --help                   display help for command
```

```text
Usage: agent-validate update [options]

Update the agent-validator Claude plugin and refresh skills

Options:
  -h, --help  display help for command
```

```text
Usage: agent-validate validate [options]

Validate config files against schemas

Options:
  -h, --help  display help for command
```

```text
Usage: agent-validate clean [options]

Archive logs

Options:
  -h, --help  display help for command
```

## Review Decision Commands

```text
Usage: agent-validate update-review [options] [command]

Manage review violations

Options:
  -h, --help          display help for command

Commands:
  list                List pending review violations with numeric IDs
  fix <id> <reason>   Mark a violation as fixed
  skip <id> <reason>  Mark a violation as skipped
  help [command]      display help for command
```

## Inspection Commands

```text
Usage: agent-validate list [options]

List configured gates

Options:
  -h, --help  display help for command
```

```text
Usage: agent-validate health [options]

Check CLI tool availability

Options:
  -h, --help  display help for command
```

```text
Usage: agent-validate status [options]

Show a summary of the most recent validator session

Options:
  -h, --help  display help for command
```

```text
Usage: agent-validate review-audit [options]

Audit review execution from the debug log (--date or --since)

Options:
  --date <YYYY-MM-DD>   Date to filter (default: today)
  --since <YYYY-MM-DD>  Include all runs from this date onwards
  -h, --help            display help for command
```

## CI Commands

```text
Usage: agent-validate ci [options] [command]

Manage CI integration

Options:
  -h, --help      display help for command

Commands:
  init            Initialize CI workflow and configuration
  list-jobs       List CI jobs (used by workflow)
  help [command]  display help for command
```

## Utility Commands

```text
Usage: agent-validate skip [options]

Advance execution state baseline without running gates

Options:
  -h, --help  display help for command
```

```text
Usage: agent-validate demo [options]

Scaffold a demo project in a temp directory

Options:
  -h, --help  display help for command
```
