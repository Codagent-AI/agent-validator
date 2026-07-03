---
title: Introduction
group: Getting Started
order: 1
description: Core Agent Validator concepts and architecture.
---

# Introduction

Agent Validator is a validation loop for AI-assisted development. It detects changed files, maps those files to configured entry points, runs the matching gates, and writes logs plus execution state so a coding agent can fix failures and rerun only the relevant validation.

## Core Concepts

Agent Validator has three main configuration concepts:

| Concept | Meaning |
| --- | --- |
| Entry point | A path in the repository that activates gates when matching files change |
| Check | A deterministic shell command such as build, lint, test, or static analysis |
| Review | An AI review prompt dispatched through a local CLI adapter |

Entry points decide when gates run. Checks and reviews decide what feedback the agent receives.

![Agent Validator Core Concepts](images/core_concepts_v2.png)

## Validation Flow

1. The CLI loads `.validator/config.yml`.
2. Git change detection finds committed, uncommitted, and untracked changes.
3. Entry points expand against the changed paths.
4. The job generator creates check and review jobs for the matching entry points.
5. Checks run shell commands; reviews run configured prompts through supported adapters.
6. Logs, review JSON, reports, and execution state are written under `log_dir`.
7. On a rerun, Agent Validator uses prior logs and execution state to verify fixes instead of starting from scratch.

## Command Names

The npm package installs two binary names:

| Binary | Status |
| --- | --- |
| `agent-validate` | Primary CLI name used by help output and skills |
| `agent-validator` | Compatibility alias |

The docs use `agent-validate` unless referring to package installation.

## Source Of Truth

For this repository, implementation behavior is sourced from code first, then current OpenSpec specs in `openspec/specs/`, then docs. Historical archived specs under `openspec/changes/archive/` are useful context but are not current behavior.
