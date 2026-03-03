# Fix stash untracked-to-tracked diff and add E2E tests

## Summary

Fix `getFixBaseDiff` (review-diff.ts) and `computeFixBaseDiffStats` (diff-stats.ts) to exclude files that were captured in a stash's `^3` (untracked) parent and subsequently committed without content changes. Also create comprehensive end-to-end integration tests covering all working-tree-ref scenarios, replacing the manual tests from PR #90.

## Files to modify

- `src/gates/review-diff.ts` — `getFixBaseDiff()` (lines ~216-287)
- `src/core/diff-stats.ts` — `computeFixBaseDiffStats()` (lines ~227-301)

## Files to create

- `test/integration/working-tree-ref-e2e.test.ts`

## Implementation steps

### Part 1: Fix the diff functions

1. **Extract shared helper** — Create a function (in `review-diff.ts` or a shared module) that:
   - Takes `currentUntracked: Set<string>`, `snapshotUntrackedFiles: Set<string>`, and `fixBase: string`
   - Computes `committedFromStash` = files in `snapshotUntrackedFiles` that are NOT in `currentUntracked`
   - For each `committedFromStash` file, compares current blob SHA (`git hash-object <file>`) against stash `^3` blob SHA (`git rev-parse <fixBase>^3:<file>`)
   - Returns the set of files that are unchanged (same blob SHA) — these should be excluded from tracked diff

2. **In `getFixBaseDiff`** (review-diff.ts):
   - After computing `snapshotUntrackedFiles` (line 244), call the helper to get `unchangedCommittedFromStash`
   - Modify the `git diff ${fixBase}${pArg}` call (line 227) to append pathspec negations for each excluded file: `-- . ':!file1' ':!file2'`
   - Alternative: run the diff as-is and post-filter the output by parsing `diff --git a/<file>` headers — simpler if pathspec negation has quoting issues

3. **In `computeFixBaseDiffStats`** (diff-stats.ts):
   - Same pattern: after computing `fixBaseUntrackedFiles` (line 265), call the helper
   - Modify `git diff --numstat` and `git diff --name-status` calls to exclude unchanged committed-from-stash files
   - Adjust the return value totals accordingly

### Part 2: End-to-end integration tests

4. **Test file setup** — Follow existing patterns from `test/integration/stop-hook-e2e.test.ts` and `test/integration/helpers.ts`:
   - Use `isDistBuilt()` guard in `beforeAll` (skip gracefully when no dist)
   - Create a temp directory with `mkdtemp` for each test
   - Initialize a git repo with `git init`, configure user, make an initial commit
   - Create a minimal `.gauntlet/config.yml` with a simple check gate (e.g., `echo pass`)
   - Clean up temp directories in `afterAll`

5. **Scenario: Tracked-only changes**:
   - Modify an existing tracked file
   - Run `agent-gauntlet run` via CLI
   - Read `.execution_state` from the log dir
   - Assert `working_tree_ref` differs from HEAD SHA
   - Assert `git cat-file -t <working_tree_ref>` returns "commit"

6. **Scenario: Tracked + untracked changes**:
   - Modify an existing tracked file AND create a new untracked file
   - Run `agent-gauntlet run`
   - Read `.execution_state`
   - Assert `working_tree_ref` differs from HEAD
   - Assert `git ls-tree -r --name-only <working_tree_ref>^3` includes the untracked file

7. **Scenario: Clean working tree**:
   - Commit all changes so the tree is clean
   - Run `agent-gauntlet run`
   - Read `.execution_state`
   - Assert `working_tree_ref` equals HEAD SHA

8. **Scenario: Untracked→tracked transition (the bug fix)**:
   - Create an untracked file, run gauntlet (captures file in stash ^3)
   - Commit the untracked file (now tracked)
   - Create a small new change (e.g., edit a different file)
   - Run gauntlet again
   - Assert the diff output does NOT include the previously-untracked-now-committed file
   - Assert only the genuinely new change appears in the diff

## Specs covered

- `run-lifecycle`: "Untracked file committed between stash and next diff" scenario
- `run-lifecycle`: "Untracked file committed and modified between stash and next diff" scenario
- `working-tree-ref-e2e`: All scenarios

## Acceptance criteria

- Running `getFixBaseDiff` with a stash ref where a `^3` file was committed unchanged produces a diff that does NOT include that file
- Running `computeFixBaseDiffStats` in the same scenario reports file counts that do NOT include that file
- Existing behavior for tracked-only changes, truly new untracked files, and known-untracked files is preserved
- All 4 E2E scenarios pass when run against the built dist (`bun test test/integration/working-tree-ref-e2e.test.ts`)
- Tests skip gracefully when dist is not built (via `isDistBuilt()` guard)
- No test depends on an LLM adapter being available
- Tests create and clean up their own temp git repos
