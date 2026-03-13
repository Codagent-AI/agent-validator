# Review: cursor-plugin-update

## Summary

Passed after 3 iterations with 15 violations fixed. All design artifacts (proposal, specs, design, tasks) are coherent and follow the required formats. Both reviewers (codex@1, claude@2) verified the fixes.

## Issues Fixed

- **tasks.md**: Rewrote checklist format to use `tasks/<slug>.md` as the entry key (fixed twice — initial format and refined format)
- **tasks/cursor-update-support.md**: Restructured to use required `## Goal`, `## Background`, `## Done When` sections; removed prohibited `## Files to modify`, `## Acceptance criteria`, `## Specs covered` sections; removed code snippets and step-by-step implementation instructions
- **specs/plugin-update/spec.md**: Added MODIFIED entry for `Plugin location detection` requirement to reflect that Claude plugin is no longer a hard requirement — error only when no adapter has a plugin installed and no Codex skills found

## Issues Skipped

None.

## Issues Remaining

None.

## Sign-off

APPROVED
