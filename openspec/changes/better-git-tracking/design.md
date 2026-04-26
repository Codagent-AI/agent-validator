## Context

Agent-validator tracks per-worktree diff baselines via `.execution_state` but has no concept of validation evidence. `.execution_state` answers "where do I diff from?" — it is intentionally written even after failed runs because `working_tree_ref` is the diff-scoping baseline for verification mode reruns. This is load-bearing per the `run-lifecycle` spec.

Cross-worktree merges force full re-validation of already-validated code because the recorded commit in `.execution_state` is far behind the post-merge HEAD. The existing `validator-merge` skill attempted to solve this by copying `.execution_state` between worktrees but had a bug (copied state retained the source branch name, triggering branch-mismatch auto-clean on next run) and required manual invocation.

The current run flow in `executeRun()` (`src/core/run-executor.ts`) is:

```
loadConfig → initContext → handleAutoClean → acquireLock → runWithLock(logger.init → gates)
```

For gate commands (`check`, `review`), `executeGateCommand()` (`src/commands/gate-command.ts`) follows a similar pattern with lock acquisition inside the function body.

## Goals / Non-Goals

**Goals:**
- Automatically recognize trusted commits across worktrees via a shared ledger
- Support the common workflow: validate on dirty tree → commit → merge elsewhere → trust recognized
- Scope validation of merge conflict resolutions to only the merge-resolution delta
- Remove the buggy `validator-merge` skill now that trust propagation is automatic

**Non-Goals:**
- Cross-machine trust sharing (pushing/pulling the ledger, CI-to-dev trust transfer)
- Config-aware trust invalidation (v1 records `config_hash` for audit but does not gate trust on it — see Decisions)
- Backwards compatibility with prior `validator-merge` skill behavior (explicitly waived)
- Handling octopus merges (>2 parents) — these validate normally

## Approach

### New module: `src/utils/trust-ledger.ts`

Single-file module responsible for all ledger operations:

```typescript
// Core operations
appendRecord(record: TrustRecord): Promise<void>
readRecords(): Promise<TrustRecord[]>
isTrusted(commit: string, tree: string): Promise<TrustLookupResult>
reconcile(ctx: ReconciliationContext): Promise<ReconciliationResult>
pruneIfNeeded(threshold: number): Promise<void>

// Helpers
getLedgerPath(): Promise<string>
computeTreeSha(ref: string): Promise<string>
```

The ledger path is resolved once via `git rev-parse --git-common-dir` + `/agent-validator/trusted-snapshots.jsonl`.

### Trust lookup: `isTrusted(commit, tree)`

Lookup priority:
1. **Exact commit match first**: find a record with `trusted: true` and `commit` matching the queried SHA. This is the fast path for commits that were directly validated or previously materialized.
2. **Tree match second**: if no commit match, find a record with `trusted: true` and `tree` matching the queried tree SHA. This handles dirty-tree validation followed by commit (the tree content is the same, the commit SHA is new).
3. Tree match SHALL only be used when the current worktree is clean (`git status --porcelain` is empty). Do not use tree-only trust while the worktree is dirty — the dirty state may have diverged from the matched tree.

v1 does NOT gate trust on `config_hash`. The field is recorded for audit and future strict mode but is not checked during lookup.

### Reconciliation insertion point

Reconciliation inserts into the run flow **after lock acquisition, before `runWithLock()` is called**. In `src/core/run-executor.ts`, this is between the `tryAcquireLock()` success and the `runWithLock()` call. If reconciliation short-circuits (HEAD is trusted), it:
- Rewrites `.execution_state` (branch=current, commit=HEAD, working_tree_ref=HEAD)
- Prints "Trusted snapshot; baseline advanced."
- Releases the lock
- Returns without ever initializing the logger or creating gate logs

The same pattern applies to `executeGateCommand()` in `src/commands/gate-command.ts`.

Reconciliation is skipped entirely if the working tree is dirty (`git status --porcelain` non-empty). In that case, existing auto-clean proceeds unchanged.

### Reconciliation logic (clean tree)

```
1. Compute HEAD commit SHA and HEAD^{tree}
2. Check isTrusted(HEAD, HEAD^{tree})
   → If trusted: advance state, exit with status "trusted"
   → If trusted via tree match: materialize a commit record (source: "ledger-reconciled"),
     then advance state and exit "trusted"
3. Check if HEAD is a 2-parent merge commit (git rev-parse HEAD^2)
   → If not a merge (or >2 parents): proceed with normal validation
4. Check if both parents are trusted
   → If neither: proceed with normal validation
   → If exactly one: set fixBase to the trusted parent's commit,
     validate HEAD against the trusted parent (captures untrusted side + any merge edits)
   → If both: proceed to unified merge path (step 5)
5. Unified merge path:
   a. git merge-tree --write-tree parent1 parent2  → synthetic merge tree SHA
   b. git diff --name-only <synthetic-tree> HEAD    → merge-resolution delta
   c. If delta is empty: auto-trust HEAD, write ledger record, exit "trusted"
   d. If delta is non-empty: set fixBase = <synthetic-tree>,
      validate only the merge-resolution delta
   e. If that scoped validation passes: write trusted record for HEAD
```

### Unified merge path: implementation notes

The diff between `git merge-tree --write-tree` output and `HEAD^{tree}` is the **merge-resolution delta** — not literally "files the user touched." This delta may include conflict marker resolutions, rename choices, or other merge machinery artifacts. The implementation should treat it as the validation scope without making claims about what it represents beyond "where the actual merge result differs from the automatic merge."

**`git merge-tree --write-tree` behavior**: This command may exit non-zero when conflicts exist but still prints a valid tree SHA as the first line of stdout. The implementation must parse the tree SHA from stdout regardless of exit code. If no tree SHA can be parsed, fall back to normal full validation.

**Git version requirement**: `git merge-tree --write-tree` requires git 2.38+. On older git versions, fall back to "validate the full merge normally" — do not fail. Check git version at startup or catch the error on first use.

### Ledger write integration

After `writeExecutionState` in both `src/core/run-executor-helpers.ts:428` and `src/commands/gate-command.ts:312`, add a conditional call to `appendRecord()`. The conditions:

- **Trust-eligible outcome**: `passed`, `passed_with_warnings`, or `no_applicable_gates`
- **Trust-eligible scope**: no `--gate`/`--review` CLI narrowing (default scope `run` or `check`)
- Partial runs and review-only runs write records with `trusted: false`
- Failures and `retry_limit_exceeded` do not write records at all

For **clean trees**: `commit = HEAD`, `tree = HEAD^{tree}`
For **dirty trees**: `commit = null`, `tree = working_tree_ref^{tree}`, `working_tree_ref = <stash SHA>`

To extract the tree from a stash-based `working_tree_ref`: `git rev-parse <working_tree_ref>^{tree}`. The stash ref is a commit object; `^{tree}` dereferences to its tree.

Errors during ledger writes are caught and logged to stderr. They never propagate or fail the run.

### Skip command integration

In `src/commands/skip.ts`, after `writeExecutionState` (line 49), add a call to `appendRecord()` with `source: "manual-skip"`. Same clean/dirty tree logic as the run completion path. Skip owns its own ledger write — it is not part of the run-completion flow.

### Validator-merge skill removal

Delete `skills/validator-merge/` entirely. Remove the skill registration from plugin manifests (`.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, etc.). Update any skill references in SKILL.md files. Users merge with `git merge` and trust propagates automatically on next validator invocation.

### Pruning

At startup (before reconciliation), check the ledger line count. If it exceeds the threshold (1000 lines):

1. Read all records
2. Collect all reachable commits via `git rev-list --all`
3. For records with non-null `commit`: keep if commit is reachable
4. For records with `commit: null` (dirty-tree records): keep if `working_tree_ref` object still exists (`git cat-file -t`)
5. Write surviving records to a temp file in the same directory
6. Atomic rename to replace the ledger

The threshold of 1000 is chosen to be generous — typical usage will produce far fewer records. The check is a simple line count (not a full parse), so it's cheap.

### Ledger record schema

```typescript
interface TrustRecord {
  commit: string | null;        // HEAD SHA, or null for dirty-tree records
  tree: string;                 // tree SHA of validated content
  config_hash: string;          // hash of gate-affecting config (audit only in v1)
  scope: ScopeDescriptor;       // structured: { command, gates, entry_points, cli_overrides }
  scope_hash: string;           // hash of scope descriptor
  validator_version: string;    // agent-validator version
  source: 'validated' | 'manual-skip' | 'ledger-reconciled';
  status: string;               // passed, passed_with_warnings, no_applicable_gates, trusted
  trusted: boolean;             // true = approved for propagation
  created_at: string;           // ISO 8601
  working_tree_ref?: string;    // stash SHA, present only for dirty-tree records
}
```

`config_hash` computation: hash the gate-affecting fields of the resolved config — `entry_points` (paths + checks + reviews), `cli.adapters`, `cli.default_preference`, `base_branch`. Exclude operational fields like `max_retries`, `log_dir`, `debug_log`. v1 computes and stores this value but does not use it for trust gating. A future strict mode can activate config-aware trust invalidation by requiring `config_hash` match in `isTrusted()`.

`scope` computation: structured descriptor containing the command name, resolved gate list, entry point paths, and any CLI overrides (`--gate`, `--review`). `scope_hash` is its deterministic hash. Like `config_hash`, v1 stores but does not gate on scope — trust is determined by the `trusted` boolean alone.

### `trusted` exit status

The `trusted` status is a success status (exit code 0). When reconciliation short-circuits:
- No gates are executed
- No gate log files are created
- No console log file is created
- The run count is not incremented
- If `--report` is used, structured output includes the status
- The message is: "Trusted snapshot; baseline advanced."

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| `config_hash` in v1 | Stored, not gated | Cheap to store now, painful to reconstruct later. v1 lookup ignores it. Future strict mode can activate it. |
| `scope` / `scope_hash` in v1 | Stored, not gated | Same rationale as `config_hash`. Trust is determined by `trusted` boolean alone. |
| Merge verification | Unified diff-tree path | One path handles both clean merges and conflict resolution. Diff between synthetic merge tree and actual tree gives the merge-resolution delta. Empty = auto-trust. Non-empty = validate only the delta. |
| `validator-merge` skill | Remove entirely | Trust propagation is automatic. Skill is vestigial. |
| Pruning trigger | Line count > 1000 | Self-regulating, no bookkeeping. Generous threshold. |
| Ledger location | `$(git rev-parse --git-common-dir)/agent-validator/` | Shared across worktrees naturally via git's common directory. |
| Dirty-tree trust | Tree-based from v1 | Handles the common validate→commit workflow. Tree match only used when worktree is clean. |
| Reconciliation placement | After lock, before logger | No logs created on short-circuit. Lock held for state mutations. |
| Tree match restriction | Clean worktree only | Don't use tree-only trust while dirty — the dirty state may have diverged from the matched tree. |
| Old git fallback | Validate normally | `git merge-tree --write-tree` requires git 2.38+. On older versions, fall back to full validation. Do not fail. |

## Risks / Trade-offs

- **Trusted merge of two trusted parents can still have semantic integration bugs** — files that don't conflict but interact incorrectly (e.g., one parent renames a function, another calls it by old name in a different file). Inherent in the "trusted parents compose" policy. If this becomes a problem, add an optional strict mode later that always runs checks after trusted merges.
- **Tree-match lookup scans all records** — O(n) per lookup. Bounded by pruning threshold (1000). Could add an in-memory index by tree SHA if performance becomes an issue.
- **`git merge-tree --write-tree` availability** — requires git 2.38+ (released Oct 2022). Most systems have this. Fallback to full validation on older git is safe but loses the merge optimization.
- **Stash-based `working_tree_ref` objects can be garbage collected** — dirty-tree ledger records become invalid if the stash SHA is gc'd before pruning removes the record. The pruning step handles this by checking `git cat-file -t`.

## Migration Plan

1. Ship the ledger module and reconciliation as a feature addition. No existing behavior changes until the first trusted record is written.
2. Delete `validator-merge` skill in the same release. Note in changelog.
3. Remove skill registrations from all plugin manifests.
4. Existing `.execution_state` files are untouched. The ledger starts empty; trust builds up organically from the first passing run.
5. **Rollback**: if issues arise, the feature can be disabled by deleting `trusted-snapshots.jsonl`. The validator falls through to normal behavior on every path — reconciliation finding no records is a no-op.

## Open Questions

None — all deferred-to-design items resolved.
