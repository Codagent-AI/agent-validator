## Context

`agent-validator init` writes a fresh `.validator/config.yml` for new projects. Today it only emits review entries chosen by `selectReviewConfig()` (primary/secondary/fallback), and only when local AI reviews are enabled. Opt-in built-in reviews — `task-compliance` and `test-integrity` — are deliberately excluded from the recommendation, but the runtime `--enable-review <name>` flag only activates entries that already exist in the config. Orchestrators like agent-runner need a way to ask init to scaffold those entries with `enabled: false` so the runtime flag has something to flip on.

Companion handoff (read for full background, regression history, and rejected approaches):
`/Users/paul/codagent/agent-runner/worktrees/task-compliance/openspec/changes/task-compliance/handoff-agent-validator.md`.

## Goals / Non-Goals

**Goals:**
- One generic CLI surface (`--enable-builtin <name>`) that any orchestrator — not just agent-runner — can call without agent-validator knowing about specific orchestrators.
- Scaffolding is correct on fresh init across all three CLI configurations (primary/secondary/fallback) and across the local-AI-reviews opt-out path.
- The generated YAML block matches the exact shape from agent-runner commit `a4f9151` (with `enabled: false` and the human-discoverable comment), so `--enable-review task-compliance --context-file <path>` works without further user action.
- Failure modes are loud: unknown names error before scaffolding; existing `.validator/` warns with paste-ready YAML.

**Non-Goals:**
- A companion `agent-validator config add-review` command for migrating existing projects. Decided against this round; revisit if real-world friction warrants it. See "Decisions" for rationale.
- Patching existing `config.yml` files from init. YAML rewrite is brittle and the user might have intentionally customized the entry.
- Changing `--enable-review` activation semantics or `dynamic-review-control` behavior.
- Scaffolding `task-compliance` for standalone (non-orchestrated) users.

## Approach

### CLI surface

Add to `src/commands/init.ts`:

```
program
  .command('init')
  …
  .option(
    '--enable-builtin <names...>',
    'Built-in opt-in review names to scaffold with enabled: false (comma or space separated). Names must come from the opt-in built-in set (currently task-compliance, test-integrity).',
  )
```

Parse the value identically to `--agents`: flatten on commas, trim, dedupe. Validate every entry against `Object.keys(optInBuiltIns)` from `src/built-in-reviews/index.ts`. If any entry isn't an opt-in built-in name (including the case where it's a primary built-in like `code-quality`), throw before any disk writes — same point in `runInit` as the existing `validateExplicitDevCLINames`.

Export the opt-in built-in name list from `src/built-in-reviews/index.ts` (today `optInBuiltIns` is module-private). The exported accessor mirrors the existing `getBuiltInReviewNames()` shape so init can build the validator and error message off the single source of truth.

### Threading

The list of validated opt-in names flows: `runInit` → `selectReviewsAndConfirmInstall` → `scaffoldValidatorDir` → `writeConfigYml`. Existing parameters stay the same; one extra argument (string array, possibly empty).

In `selectReviewsAndConfirmInstall`, the list is independent of whether the user opted out of local AI reviews. The current code returns `reviewConfig: { type: 'none', reviews: [] }` for the opt-out branch; the new logic appends the opt-in entries onto whatever `reviewConfig.reviews` ended up being. The cleanest place to materialize the opt-in `ReviewEntry`s is in `init-reviews.ts` next to `selectReviewConfig`, e.g.:

```ts
export function buildOptInBuiltinEntries(names: string[]): ReviewEntry[] {
  return names.map((name) => ({
    name,
    builtin: name,
    enabled: false,
  }));
}
```

`ReviewEntry` gains `enabled?: boolean`. Existing recommended entries don't set it (runtime default is `true`). Only opt-in entries set it (always `false`).

### YAML emission

`writeConfigYml` already serializes inline reviews via `yaml.stringify`. Two new requirements:

1. **`enabled: false` must be emitted on opt-in entries.** The existing builder pushes properties in order: `builtin`, `num_reviews`, then optional `cli_preference`, `model`. Add `enabled` (only if defined) after `builtin`. Keep `num_reviews` for opt-in entries too (matches everything else; harmless at runtime since the entry is disabled by default).

2. **The activation-form comment must be attached to the `enabled: false` line.** This is the load-bearing detail from the handoff. `yaml.stringify` does not natively attach trailing comments to inline map keys. The implementer has two viable paths:

    - **Document API (preferred).** Build the entry point as a `Document` / `YAMLMap` node, locate the `enabled` `Pair`, and set `pair.value.comment = ' Opt-in: activate with \`agent-validator run --enable-review <name> --context-file <task>\`'` (or set `pair.comment` for a trailing comment on the key line). Then stringify the Document. Yields the correct `enabled: false # Opt-in: …` form.
    - **String post-process.** Stringify normally, then regex-replace the opt-in entries' `enabled: false` line with `enabled: false # Opt-in: …`. Acceptable if the Document API path is fiddlier than expected; less robust to future formatting changes.

    Either way, the comment text MUST reference the matching `--enable-review <name>` form for the specific entry (`task-compliance` vs `test-integrity`), so the comment is useful to a human reading the file.

3. **Opt-in entries must be written even when `reviewConfig.reviews` is empty.** Today `writeConfigYml` only sets `rootEntryPoint.reviews` when `inlineReviews.length > 0`. Change the gate to include opt-in entries: if recommended OR opt-in entries exist, emit `reviews:`; otherwise omit it (preserves the existing opt-out scenario when no `--enable-builtin` is passed).

### Existing-`.validator/` warning

In `runInit`, the existing-config branch (`if (existingConfigDir)`) currently prints `dim` "skipping scaffolding" and delegates to `handleRerun`. When `--enable-builtin` is passed, print a yellow warning *before* the delegation, of the form:

```
Warning: --enable-builtin was passed but .validator/ already exists.
The following entries were NOT added to .validator/config.yml. To enable them,
paste the YAML block below under an entry point's `reviews:` list:

  - task-compliance:
      builtin: task-compliance
      enabled: false  # Opt-in: activate with `agent-validator run --enable-review task-compliance --context-file <task>`
```

One warning, one consolidated YAML block listing all requested entries. The warning is unconditional — we don't try to detect whether the entries already exist; the user just gets pointed at the right paste.

## Decisions

### Flag shape: `--enable-builtin <name>` (repeatable)

Chosen over `--orchestrator <name>` and `--with-task-compliance`. Rationale:

- Mirrors agent-validator's own `--enable-review` runtime naming. Users reading either flag will recognize the symmetry.
- Generic — works for any current or future opt-in built-in without re-litigating. The set is gated by `optInBuiltIns`, so the surface stays controlled.
- Does not couple agent-validator to knowing about specific orchestrators by name.

### Migration: "accept the gap" for existing `.validator/` directories

Chosen over a companion `agent-validator config add-review` command. Rationale:

- The migration population is small: only projects that already ran `agent-validator init` before this lands AND want to start using an orchestrator that calls the new flag. Brand-new agent-runner projects (the main motivating use case) hit the fresh-init path.
- A companion command means new surface area, idempotency guarantees, YAML-rewrite edge cases (custom indentation, comments, anchors, multi-entry-point configs). That's a non-trivial follow-on, not a one-liner.
- The warning + paste-ready YAML closes the loop for the rare manual case without writing a new code path. If real users report friction we can build the companion command then; nothing in this decision precludes adding it later.

### Generalize over opt-in built-ins

`optInBuiltIns` already exists in `src/built-in-reviews/index.ts` as a concept. Hardcoding `task-compliance` would mean a second hardcoded list in `init.ts` and a re-litigation when `test-integrity` (already declared opt-in!) becomes a need. The generalized path has trivial additional cost.

### Opt-out of local AI reviews + `--enable-builtin` → still write the opt-in entry

The orchestrator is the activator. The user's "no local AI reviews" choice is about the recommended reviews running automatically on every change. Opt-in entries don't run automatically — they're dormant until the orchestrator passes `--enable-review` at runtime. Honoring opt-out by dropping the opt-in entry would silently break the orchestrator's expectation and is the failure mode this whole change is designed to prevent.

The modified `Confirmed local AI review opt-out writes no review entries` scenario carves out exactly this case: opt-out without `--enable-builtin` writes no reviews block; opt-out with `--enable-builtin` writes a reviews block containing only the opt-in entries.

## Risks / Trade-offs

- **YAML comment emission is fiddly.** The `yaml` library supports it via the Document API but the existing call site uses the plain stringify path. Implementer should prototype both approaches early.
- **Existing-`.validator/` warning is paper for a real gap.** The warning is correct but easy to miss in agent-runner's noisy install output. If real users hit the gap, the companion command becomes the next natural step. Captured as a follow-up, not a blocker.
- **`enabled: false` comment text drift.** Two places will say roughly the same thing — the YAML comment and the docs. They will drift unless the implementer keeps the comment string in one constant in `init-config-helpers.ts` and references it from any doc updates.
- **Coordination with agent-runner release.** This change has to ship and be released before agent-runner's `task-compliance` branch can finish. Captured in the handoff; managed at release time.
