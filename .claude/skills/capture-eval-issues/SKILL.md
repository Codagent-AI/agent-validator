---
name: capture-eval-issues
description: >-
  Capture noteworthy review violations for the eval framework. Use when
  gauntlet-run finds review failures — judges violations and saves notable
  ones to evals/inventory.yml.
disable-model-invocation: false
allowed-tools: Bash, Task, Read
---

# /capture-eval-issues

Capture noteworthy review violations into the eval inventory.

## Input

This skill receives one or more review JSON file paths as arguments (space-separated).
Example: `/capture-eval-issues gauntlet_logs/review_src_claude@1.0.json gauntlet_logs/review_src_gemini@2.0.json`

## Procedure

1. Read `judge-prompt.md` from this skill's directory
2. Spawn a subagent to judge and capture violations:
   - **Task tool**: `Task` with `subagent_type="general-purpose"`, `model="sonnet"`, `prompt=` judge-prompt content + `"\n\nReview JSON files: <file paths>\n\nSkill directory: <this skill's directory path>"`
   - The subagent handles everything: reading files, judging, calling the append script
3. Report the subagent's capture summary (the `CAPTURED:` line)
