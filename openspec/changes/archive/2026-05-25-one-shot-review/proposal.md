## Why

Agent Validator re-dispatches the `task-compliance` AI reviewer on every rerun iteration. On reruns the diff is narrowed to fix-only changes (via `working_tree_ref`), so the reviewer no longer sees the full implementation it was supposed to verify against the original task spec. The rerun-mode prompt also redirects the reviewer to "verify previous fixes only," which is incoherent for an acceptance review whose contract is "did this diff fulfil the task." The result is misleading findings, false passes/fails, and wasted tokens.

Task compliance is an **acceptance review** against a fixed baseline (the task spec). It is one-shot by nature: it should evaluate the implementation against the spec exactly once per task baseline, and the retry loop should then drive remediation through stored violation statuses (`update-review fix`/`skip`).

## What Changes

- Add an optional `one_shot` boolean field to all review config formats (YAML, Markdown frontmatter, inline). Default: `false`. When `builtin: task-compliance` is used, the default flips to `true`.
- In rerun mode, when a one-shot review has a previous review JSON in the log directory and no invalidating condition applies, the validator MUST suppress AI dispatch for that review and synthesise the gate result purely from the stored violation statuses.
- Each suppressed rerun iteration MUST write a fresh per-iteration log file with a new gate status `preserved_one_shot` that carries forward the previous run's violations so the retry loop sees the gate ran and can read its outstanding violations.
- Invalidation rules (cause a fresh first-run dispatch instead of suppression):
  - The most recent JSON for this review has `status: "error"` or is unparseable.
  - No usable prior JSON exists (this is naturally a first-run case already — restated for clarity, no special branch needed).
- A logs-cleaned / new-session run is naturally a first run again — no special invalidation logic required beyond existing clean behaviour.
- Update Agent Validator's bundled init scaffolding for `task-compliance` to surface the new default in the generated `.validator/config.yml` snippet (informational; users who do nothing still get one-shot behaviour because the default flips when `builtin: task-compliance` is used).

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `review-config`: add the `one_shot` field to all three review config schemas and define the built-in default override for `task-compliance`.
- `run-lifecycle`: define rerun behaviour for one-shot reviews — AI-suppression, status synthesis from stored JSON, the `preserved_one_shot` per-iteration log, and the error-invalidation rule.
- `dynamic-review-control`: state that `task-compliance` is one-shot by default in addition to being opt-in.

## Out of Scope

- Any change to `agent-runner` (`workflows/core/run-validator.yaml`). The runner may continue passing `--enable-review task-compliance --context-file <task>` on every retry; Agent Validator will suppress the redispatch internally. A separate follow-up may stop the runner from sending the flag on reruns.
- Re-verification of `fixed` violations (textual or AI). Stored `fixed` status is trusted as it is for all other reviews today.
- Treating context-file content/path as part of one-shot identity. A new task spec is the user's responsibility to start with a clean log directory.
- Forcing redispatch via `--enable-review` overrides. The flag continues to activate disabled reviews but does not bypass one-shot suppression.

## Impact

- **Code**: `src/config/schema.ts`, `src/config/load-reviews.ts`, `src/config/types.ts` (schema + LoadedReviewGateConfig), `src/gates/result.ts` and `src/gates/review-types.ts` (new `preserved_one_shot` status), `src/gates/review.ts` and/or `src/gates/review-helpers.ts` (suppression and synthesis logic), `src/utils/log-parser.ts` and `src/utils/log-parser-find-helpers.ts` (recognise the new status as a non-failure terminal state), `src/built-in-reviews/index.ts` (one_shot default for `task-compliance`).
- **Init scaffolding**: `agent-validator init --enable-builtin task-compliance` SHOULD continue producing a working snippet; surface the new default in generated comments. No breaking change for existing configs that already opted into the built-in.
- **Tests**: new tests under `test/core/` and `test/gates/` covering: rerun suppression with mixed stored statuses, prior-error invalidation, status synthesis (`new` → fail, all-`fixed` → pass, any `skipped` → passed_with_warnings), and that non-one-shot reviews still rerun normally.
- **Docs / config reference**: document `one_shot` alongside `enabled` in the review config reference.
- **No CLI changes**.
- **No breaking changes**: default for user-defined reviews remains `false` (rerun as before).
