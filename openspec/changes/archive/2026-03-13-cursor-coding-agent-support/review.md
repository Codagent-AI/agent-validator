# Review: cursor-coding-agent-support

## Summary

Passed after 4 gauntlet iterations (15 fixed, 1 skipped). The initial task files used incorrect headings and format, had over-split tasks, included code snippets, and had a standalone test task. Two spec scenarios had issues (ambiguous hook scenario, Cursor-behavior-describing scenario). All were fixed.

## Issues Fixed

- Task files reformatted: `## What`/`## How`/`## Files`/`## Specs` → `## Goal`/`## Background`/`## Spec`/`## Done When`
- Verbatim spec scenarios added to all task files
- Removed `## Files` sections (implementation detail belongs in Background)
- Merged 3 tiny tasks (plugin manifest + hooks file + package.json) into single `cursor-plugin-assets` task
- Merged interface-only task (`cli-adapter-plugin-interface`) into `claude-adapter-plugin` task
- Removed standalone `Add tests` task — tests ship with each feature task
- Removed code snippets from task files
- Split ambiguous hook scenario into Claude-specific and Cursor-specific scenarios
- Reframed asset discovery scenario to describe system behavior, not Cursor's behavior
- Fixed spec requirements missing SHALL/MUST keywords

## Issues Skipped

- Codex reviewer flagged that Claude hooks-file scenarios from `init-hook-install` delta spec aren't traced to a task. Skipped because those are unchanged existing behavior carried forward in a MODIFIED requirement block — no implementation work needed.

## Issues Remaining

None.

## Sign-off

APPROVED — gauntlet passed. All artifacts are coherent and ready for implementation.
