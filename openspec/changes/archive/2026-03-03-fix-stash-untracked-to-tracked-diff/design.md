## Context

PR #90 fixed `createWorkingTreeRef` to use `git stash push --include-untracked` (producing a proper 3-parent stash with `^3` = untracked files tree). The downstream diff consumers (`getFixBaseDiff` in `review-diff.ts` and `computeFixBaseDiffStats` in `diff-stats.ts`) already handle untracked files via `getStashUntrackedFiles(fixBase)` which reads `^3`.

However, both functions only use the `^3` information to classify **currently-untracked** files. When a file transitions from untracked (in `^3` at stash time) to tracked (after commit), it falls through both filters:
- `git diff <stash>` (line 227 in review-diff.ts, line 230 in diff-stats.ts) shows it as a "new file" because the stash's main tree doesn't contain it
- The `currentUntracked` filter doesn't catch it because it's no longer untracked
- The `snapshotUntrackedFiles` filter only applies to files that are still untracked

This produces a full "new file" diff for content that was already verified, causing redundant reviews and inflated file counts.

## Goals / Non-Goals

**Goals:**
- Filter out files from the tracked diff that were captured in the stash's `^3` parent and whose content hasn't changed since then
- Handle the case where such files HAVE been modified after commit (allow full new-file diff — see Decision #2)
- Add end-to-end tests covering all working-tree-ref scenarios using real git repos
- Update the run-lifecycle spec to reflect `git stash push` (per PR #90) and the untracked→tracked transition behavior

**Non-Goals:**
- Changing how `createWorkingTreeRef` works (PR #90 is correct)
- Changing the change-detector file list (it uses its own diff logic)
- Handling other stash edge cases beyond the `^3` transition

## Decisions

### 1. Identify "committed-from-stash" files as a new category

After computing `snapshotUntrackedFiles`, derive a new set: files that are in `snapshotUntrackedFiles` but NOT in `currentUntracked`. These are files that were untracked at stash time but are now tracked (committed). Call this set `committedFromStash`.

### 2. Filter tracked diff using `--diff-filter` exclusion

Rather than post-processing the diff string, use `git diff` with path exclusions for unchanged committed-from-stash files. For each file in `committedFromStash`, compare its current blob (`git hash-object <file>`) against the `^3` blob (`git rev-parse <fixBase>^3:<file>`). If identical, exclude the file from the tracked diff via `-- ':!<file>'` pathspec negation. If different, keep it in the tracked diff (the `git diff fixBase` output correctly shows the delta from the stash's perspective, which is the full file since it wasn't in the main tree — but this is an uncommon edge case and acceptable).

**Rationale**: Pathspec negation is simpler than parsing and filtering diff output. The common case (file committed unchanged) is handled cleanly. The rare case (file modified after commit) shows a "new file" diff which, while not optimal, is correct and safe.

### 3. Apply the same fix in both `getFixBaseDiff` and `computeFixBaseDiffStats`

Both functions have the same structural issue. Extract a shared helper `getCommittedFromStashUnchanged(fixBase, currentUntracked, snapshotUntrackedFiles)` that returns the set of files to exclude.

### 4. E2E test approach: real git repo, real CLI

Create `test/integration/working-tree-ref-e2e.test.ts` that:
- Sets up a temporary git repo with a `.gauntlet/config.yml` and a simple check gate
- Tests the full lifecycle: make changes → run gauntlet → verify execution state → make more changes → run gauntlet → verify diff scoping
- Covers four scenarios: tracked-only, tracked+untracked, clean tree, untracked→tracked transition
- Uses `isDistBuilt()` + `isClaudeAvailable()` guards (matching existing integration test patterns) — but since these tests exercise the CLI `run` command with check gates only (no reviews needing an LLM adapter), they can use a relaxed guard that only needs the dist build

## Risks / Trade-offs

- **Risk**: The pathspec negation approach (`':!file'`) may have edge cases with filenames containing special characters. Mitigation: quote paths consistently.
- **Trade-off**: For the rare "modified after commit" case, we show a full new-file diff rather than an incremental diff from ^3. This is acceptable — the file genuinely changed and a full diff is a conservative approach.
- **Trade-off**: The E2E tests will be slower than unit tests since they create real git repos and run the CLI. Mitigation: use the smallest possible config (single check gate, no reviews).

## Migration Plan

No migration needed. The fix is purely behavioral — existing execution state files work as-is. The fix only changes how the diff is computed against them.

## Open Questions

None — the fix is well-scoped and the code paths are clear.
