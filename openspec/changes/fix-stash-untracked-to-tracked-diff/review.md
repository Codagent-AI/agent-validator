# Review: fix-stash-untracked-to-tracked-diff

## Summary

Passed after 2 iterations. The design artifacts are coherent and well-scoped. The proposal correctly identifies the stash `^3` untracked-to-tracked transition gap, the design makes sound technical decisions (pathspec negation for unchanged files, shared helper across both diff functions), and the specs provide clear scenario coverage including the edge cases. The single combined task file covers both the fix and E2E test acceptance criteria.

## Issues Fixed

- **Design/spec inconsistency (HIGH)**: The design's Decision #2 stated that modified-after-commit files should show a full new-file diff (acceptable trade-off), but the run-lifecycle spec's "Untracked file committed and modified" scenario originally said the diff should show "only the changes since the stash snapshot." Fixed by aligning both: design goals now say "allow full new-file diff" for the rare modified case, and the spec scenario says the file "SHALL appear as a new file showing its full current content" with a NOTE explaining why this is acceptable.
- **Design goals wording (HIGH)**: Updated the Goals section in design.md to match Decision #2 — changed from "show only the incremental delta" to "allow full new-file diff" for the modified-after-commit case.

## Issues Skipped

- **review-audit.ts lint (pre-existing)**: File exceeds 500-line limit (512 lines) and has a formatting issue. Pre-existing and unrelated to this change.
- **review-audit.ts --date/--since mutual exclusivity (pre-existing)**: Code-quality review finding about flag handling. Pre-existing and unrelated to this change.
- **Task breakdown granularity (MEDIUM)**: Artifact review suggested splitting into more granular tasks. Skipped because the user explicitly requested combining the two tasks into one, with E2E tests as acceptance criteria for the fix.

## Issues Remaining

None.

## Sign-off

APPROVED
