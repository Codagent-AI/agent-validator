## Why

When a file is captured in a stash's `^3` (untracked) parent and subsequently committed before the next gauntlet run, `getFixBaseDiff` incorrectly reports it as a "new file" — because `git diff <stash>` only sees the stash's main tree (tracked files), not the `^3` parent. This causes redundant re-review of files already verified by a prior run, wasting tokens and producing false violations. Additionally, the stash/working-tree-ref scenarios (tracked-only, tracked+untracked, clean tree, untracked→tracked transition) were only tested manually during PR #90 — they need automated end-to-end coverage.

## What Changes

- Filter the tracked diff in `getFixBaseDiff` to exclude files whose content matches the stash's `^3` untracked tree, preventing the untracked→tracked transition from producing spurious "new file" diffs
- Create a new end-to-end test file covering all working-tree-ref scenarios against a real git repo (not mocked)

## Capabilities

### New Capabilities

- `working-tree-ref-e2e`: End-to-end test suite exercising all stash/working-tree-ref scenarios against real git repos (tracked-only, tracked+untracked, clean tree, untracked→tracked transition after commit)

### Modified Capabilities

- `run-lifecycle`: Fix the `getFixBaseDiff` function to correctly handle files that transition from untracked (in stash `^3`) to tracked (after commit), updating the "Session Reference for Re-run Diff Scoping" requirement. Also update spec language from `git stash create` to `git stash push` per PR #90.

## Impact

- `src/gates/review-diff.ts` — `getFixBaseDiff()`: filter tracked diff output against `snapshotUntrackedFiles`
- `src/core/diff-stats.ts` — `computeFixBaseDiffStats()`: same filtering for consistency
- `test/integration/working-tree-ref-e2e.test.ts` — new test file
- `openspec/specs/run-lifecycle/spec.md` — requirement update
