## Context

Agent Validator dispatches review gates through the executor in `src/core/runner.ts` and `src/gates/review.ts`/`src/gates/review-helpers.ts`. On reruns (when the log directory contains `.log` files for the active session), the system parses the highest-numbered prior log per slot via `src/utils/log-parser.ts` and injects previously-reported violations into the review prompt. The rerun-mode prompt (`buildPreviousFailuresSection` in `src/gates/review-prompt.ts`) instructs the reviewer to "verify previous fixes only" against a diff narrowed to fix-only changes (`working_tree_ref` from `.execution_state`).

That contract is wrong for the built-in `task-compliance` review. Task compliance is an acceptance review: it evaluates the *full implementation* against the *original task spec*, not "did the fix to violation N look right." On rerun, the reviewer sees only the fix diff and no longer the implementation diff that was being evaluated, so its findings drift and the retry loop produces stale, misleading state.

Today's rerun pipeline has one neighbouring concept worth highlighting: `skipped_prior_pass` (in `src/gates/review-types.ts`, `src/gates/review-helpers.ts`, `src/utils/log-parser-find-helpers.ts`). That mechanism skips slots within a `num_reviews > 1` gate when one slot already passed, writing a `skipped_prior_pass` log file so log parsers and the run aggregator see the slot ran. The one-shot design intentionally mirrors this pattern at the *gate* level instead of the slot level.

## Goals / Non-Goals

**Goals:**

- Make `task-compliance` produce its findings exactly once per session and let the retry loop drive remediation via `update-review fix`/`skip` from there on.
- Introduce a general `one_shot` review property so the policy is not hard-coded to the built-in name.
- Keep the gate visible to the retry loop, run aggregator, `--report` output, and `update-review` flow on every suppressed iteration (don't silently disappear).
- Preserve existing behaviour for all non-one-shot reviews (code-quality, security, error-handling, user-defined).

**Non-Goals:**

- AI- or text-based verification of `fixed` claims. We trust `update-review fix` exactly as we do today for other reviews.
- Treating the context file's path or content as part of the one-shot identity. A new task spec = a new session = a clean log directory (user's responsibility, mirroring existing `clean` flow).
- Modifying `agent-runner` to stop passing `--enable-review task-compliance --context-file <task>` on every retry. The runner-side cleanup is a separate follow-up; the validator-side suppression makes the redundant flag harmless.
- Adding new CLI flags or commands.

## Approach

### Schema and load

Add `one_shot?: boolean` to the three review schemas in `src/config/schema.ts`:

- `reviewGateSchema` (the legacy/non-YAML schema used at gate-config level)
- `reviewPromptFrontmatterSchema` (`.md` frontmatter)
- `reviewYamlSchema` (`.yml`/`.yaml`)

Zod default for all three: `false`.

In `src/config/load-reviews.ts`, after building the merged `LoadedReviewGateConfig`, apply the built-in default: if `builtin === 'task-compliance'` and the user did not provide an explicit `one_shot`, set `one_shot: true` on the loaded config. The distinction between "omitted" and "explicit false" is preserved by reading the raw parsed value before applying Zod defaults (alternative: keep the schema default `undefined` and only apply the Zod default after the built-in override). Pick whichever is mechanically easier; the spec scenarios are explicit on both cases.

Add `one_shot: boolean` to `LoadedReviewGateConfig` in `src/config/types.ts`.

### Suppression decision

The decision point is *just before* the AI invocation for a review slot, in `src/gates/review.ts` / `src/gates/review-helpers.ts` (the same code path that already handles `skipped_prior_pass`). Pseudocode:

```
if (gateConfig.one_shot && isRerun) {
  const prior = readLatestPriorJson(slot)
  if (prior && prior.status !== 'error') {
    return writePreservedOneShotLog(prior)   // synthesise + log, skip AI dispatch
  }
  // else: fall through to normal dispatch as a first-run invocation
}
```

This requires:

- A reader for the highest-numbered prior JSON for a given review/slot. `src/utils/log-parser-find-helpers.ts` already locates "latest iteration per slot" for the `skipped_prior_pass` machinery — reuse or factor out.
- A new helper `writePreservedOneShotLog(prior)` modelled on `writeSkippedSlotLog` (`src/gates/review-helpers.ts` lines ~226–269) that emits both the `.log` (human-readable trace) and the `.json` (machine-readable). The JSON sets `status` to either `"preserved_one_shot"` (when synthesised pass) or `"fail"` (when carrying forward `new` violations). Violations are carried forward verbatim, preserving each `v.status`.

### First-run invocation when prior errored

When the prior JSON has `status: "error"` (or is missing/unparseable), the review must run as if it were a first-run dispatch — *not* in rerun-verification mode. Concretely: do not inject `previousViolations` into the prompt and do not narrow the diff to `fixBase`. The cleanest implementation is to compute, before the prompt build, a per-review-slot boolean `forceFirstRun = gateConfig.one_shot && (priorErrored || !priorExists)`. When `forceFirstRun` is true:

- `buildReviewPrompt` receives an empty `previousViolations` array (no rerun header gets emitted).
- The diff computation for this slot uses the full base-branch / first-run diff rather than the narrowed `fixBase` diff. This requires per-slot diff scoping. If the change-detector pipeline computes a single shared diff today and threading per-slot diffs is invasive, the acceptable simplification is to *still* use the narrowed diff but skip rerun-mode prompt features; document that limitation here and revisit if it harms quality. Decision: implement per-slot diff scoping for one-shot first-run dispatches because the whole point of one-shot is "evaluate the full implementation against the task spec." A narrowed first-run dispatch defeats it.

### Status synthesis rules

Implemented in the new `writePreservedOneShotLog` helper, mirroring the spec:

```
if any v.status === 'new' (or missing): slot status = 'fail'
elif any v.status === 'skipped':       slot status = 'pass' (warnings surface via existing hasSkippedViolationsInLogs)
else (all 'fixed' or empty):           slot status = 'pass'
```

`status === 'pass'` translates to log `status: "preserved_one_shot"`. `status === 'fail'` translates to log `status: "fail"`. This split keeps the `pass` path symmetrical with `skipped_prior_pass` (which the aggregator already understands as a non-failure terminal state) while leaving the `fail` path indistinguishable from a normal failed review for the aggregator — which is the desired behaviour, because `findPreviousFailures` and the retry-loop policy already do the right thing for a `fail` JSON with `status: new` violations.

### Recognising `preserved_one_shot`

Update the existing predicates so they treat `preserved_one_shot` as a non-failure terminal state, the same way they treat `skipped_prior_pass`:

- `src/utils/log-parser.ts` line 57: extend the pass-or-skipped-prior-pass check.
- `src/utils/log-parser-find-helpers.ts` lines 109–127: extend both the JSON-status check and the textual `Status: skipped_prior_pass` check (mirror with `Status: preserved_one_shot`).
- Type unions in `src/gates/review-types.ts` (`status` union, ~line 85) and `src/gates/result.ts` (`status` union, line 16; `passIteration?` becomes `passIteration?` or `preservedFromIteration?`).

### Init scaffolding

`agent-validator init --enable-builtin task-compliance` currently writes a snippet that pins `enabled: false` with an explanatory comment. Update the snippet to surface the new default in the generated comment without writing `one_shot: true` explicitly — the load-time built-in default does the work. (Writing it explicitly would be redundant but harmless. Decide based on whether the generated snippet aims to be self-documenting; the spec allows either.)

### Existing tests to preserve

`test/core/job.test.ts` and `test/config/loader.test.ts` already cover `task-compliance` enable/disable semantics. None of those scenarios should change. New tests live alongside them and in `test/gates/` covering: schema default behaviour, built-in default override, rerun suppression with mixed stored statuses, prior-error invalidation, and that non-one-shot reviews still rerun.

## Decisions

- **One field, not a policy enum.** A `one_shot: true` boolean is simpler than `rerun_policy: once|verify|always`. If we later need more rerun policies, we can promote it; YAGNI for now. The handoff asked the question; the simpler shape wins.
- **Built-in default override at load time, not in the schema.** Keeping the schema default `false` and overriding for `builtin: task-compliance` in the loader lets a user opt out with an explicit `one_shot: false` while keeping the schema universal. A schema-level `.default(builtin === 'task-compliance')` is awkward in Zod and harder to reason about across the three schemas.
- **`preserved_one_shot` is a distinct status, not a flavour of `pass`.** Two reasons: (1) telemetry/log greppability — operators can see at a glance which iterations preserved versus actually ran; (2) symmetry with `skipped_prior_pass`, which already established the pattern of "the slot did not invoke the adapter but still produced a terminal result." The aggregator treats both as non-failure.
- **Fail-state preserved logs use `status: "fail"` (not a new status).** Carrying forward `new` violations is functionally identical to a fresh failed review for downstream consumers (`findPreviousFailures`, `update-review`, the retry loop). Inventing `preserved_one_shot_fail` would force every consumer to know about the variant for no behavioural difference. The presence of `preservedFromIteration` in the JSON disambiguates for telemetry.
- **AI dispatch on prior-error invalidation runs as a true first-run, not rerun-verification.** The whole point is "this review evaluates the full implementation against the task spec." Dispatching it in rerun-verification mode (narrow diff, "verify fixes only" header) would reproduce the original bug.
- **`--enable-review` does not bypass suppression.** The flag's contract is "activate disabled reviews for job generation." Conflating it with "force AI redispatch" would create a surprising override. A user who actually wants a fresh task-compliance run today should clean their logs.
- **No agent-runner change in this PR.** The runner sending the flag is harmless after this lands. A separate follow-up can tighten the contract.

## Risks / Trade-offs

- **`new` violations in a preserved log are written under a new iteration filename.** Subsequent `update-review fix <id>` operations must target the latest iteration. The existing `update-review` flow scans the highest-numbered JSONs (per `src/commands/update-review.ts` and the shared enumeration logic with `--report`), so this should work transparently — but it's worth a targeted test (`update-review fix` on a violation that originated in a `preserved_one_shot` log).
- **Per-slot diff scoping for prior-errored one-shot dispatches** is new plumbing. If the change-detector pipeline assumes a single shared diff per run, this could be invasive. Mitigation: implement as a per-review override that bypasses `fixBase` for the suppressed-and-now-recovering slot only.
- **Operator surprise.** A user looking at the rerun logs may wonder why task-compliance "didn't run." The `preserved_one_shot` status string, the `preservedFromIteration` field, and a clear log line in the `.log` file (`"Preserved one-shot review state from iteration N (no AI dispatch)"`) mitigate this. Documentation in the review config reference is also called out as in-scope.
- **Quietly preserving an erroneous initial finding.** If the very first task-compliance run produced a bad violation list (hallucination, misread spec), the retry loop will now thrash trying to "fix" something that wasn't real, with no opportunity for a fresh AI pass. Counter: `update-review skip <id> "false positive"` is the documented escape hatch and is unchanged. The trade-off is acceptable because the alternative (re-dispatching every rerun on a narrowed diff) produces *worse* false positives.
- **Future review types that want partial-rerun semantics.** A boolean is too coarse if we later need "rerun for new violations but trust fixed ones." We can promote `one_shot: true` to `rerun_policy: once` at that point. Migration would be straightforward (deprecate the boolean, keep accepting it for one release).
