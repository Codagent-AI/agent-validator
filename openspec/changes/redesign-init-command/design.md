# Init Command Redesign

## Overview

Redesign `agent-gauntlet init` from a non-interactive scaffolding command into a guided, phased setup experience. The new init asks which CLIs are used for development vs reviews, installs hooks and skills accordingly, handles re-runs gracefully with checksum-based file comparison, and provides clear instructions for non-native CLI users.

## Phases

### Phase 1 — CLI Detection

- Detect all available CLIs via `isAvailable()` in preference order
- Display check/cross marks for each CLI
- Exit early if no CLIs found (unchanged)

### Phase 2 — Development CLI Selection

- Print explanation: "Select your development CLI(s). These are the main tools you work in."
- Multi-select prompt from detected CLIs
- For each selected CLI:
  - If it supports hooks (Claude, Cursor) → mark for hook installation in Phase 5
  - If it doesn't (Codex, Gemini, GitHub Copilot) → warn: "[CLI] doesn't support hooks yet, skipping hook installation"

### Phase 3 — Review CLI Selection & Config

- Print explanation: "Select your reviewer CLI(s). These are the CLIs that will be used for AI code reviews."
- Multi-select prompt from detected CLIs
- Selected CLIs become `cli.default_preference` in config
- Print: "Agent Gauntlet's built-in code quality reviewer will be installed."
- If 1 review CLI selected → set `num_reviews: 1` automatically
- If multiple review CLIs selected → prompt: "How many of these CLIs would you like to run on every review?" (1 to N)

### Phase 4 — Scaffold `.gauntlet/`

- If `.gauntlet/` does not exist → create it with full scaffolding (existing behavior: directory structure, config.yml, default review, .gitignore entry, status script)
- If `.gauntlet/` already exists → skip entirely, no modifications to anything inside `.gauntlet/`

### Phase 5 — Install External Files

Runs always, regardless of Phase 4 outcome.

**Checksum logic per file/skill:**

1. **Missing** → create silently
2. **Exists, checksum matches** → skip silently
3. **Exists, checksum differs** → prompt: "Skill `gauntlet-run` has changed, update it?"

**Skills:**
- Always installed to `.claude/skills/`
- Checksum computed over all files in the skill directory (`SKILL.md` + `references/`)
- One prompt per changed skill

**Hooks:**
- Installed based on Phase 2 development CLI selection
- Only for CLIs with hook support (Claude, Cursor)
- Checksum computed on gauntlet-specific hook entries
- One prompt per changed hook file

### Phase 6 — Instructions

**For Claude Code / Cursor users:**
- "To complete setup, run `/gauntlet-setup` in your CLI. This will guide you through configuring the static checks (unit tests, linters, etc) that Agent Gauntlet will run."

**For non-Claude/non-Cursor CLIs:**
- "To complete setup, reference the setup skill in your CLI: `@.claude/skills/gauntlet-setup/SKILL.md`. This will guide you through configuring the static checks (unit tests, linters, etc) that Agent Gauntlet will run."
- List all available skills with `@file_path` syntax and one-line descriptions

**Mixed selection** (both native and non-native CLIs): print both sets of instructions.

## `--yes` Flag Behavior

Skips all interactive prompts with these defaults:
- **Development CLIs**: All detected CLIs selected
- **Review CLIs**: All detected CLIs added to `default_preference`
- **`num_reviews`**: Number of selected review CLIs (all of them)
- **File overwrites**: Overwrite all changed files without asking

## Key Changes from Current Behavior

1. **Interactive CLI selection** — replaces automatic "install for everything detected"
2. **Dev vs review CLI distinction** — hooks only for dev CLIs, `default_preference` from review CLIs
3. **Re-runnable init** — no early exit when `.gauntlet/` exists; checksum-based updates for external files
4. **Unified skill installation** — always to `.claude/skills/`, with `@file_path` instructions for non-native CLIs
5. **`num_reviews` configuration** — prompted during init based on review CLI count
6. **Built-in reviewer announcement** — explicit messaging about the code quality reviewer

## Pre-factoring

No hotspots modified.
