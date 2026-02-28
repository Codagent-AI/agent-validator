## Context

Reviews like `task-compliance` run unconditionally on every gauntlet invocation, even when there's no task context. This wastes time and CLI credits. The review system already supports conditional execution via `run_in_ci` / `run_locally`, but has no mechanism for reviews that should be off by default and explicitly activated.

## Goals / Non-Goals

**Goals:**
- Allow review configs to declare `enabled: false` so they're skipped by default
- Provide a CLI flag `--enable-review <name>` to activate disabled reviews at runtime (additive — all enabled reviews still run)
- Update gauntlet-run skills (both copies) to conditionally pass `--enable-review task-compliance` when task context exists
- Update flokay's implementer prompt to instruct subagents to use the flag
- Set `enabled: false` on task-compliance review in both this project and flokay

**Non-Goals:**
- Disabling reviews that are normally enabled via CLI (no `--disable-review` flag)
- Changing the `--gate` filter semantics
- Environment-variable-based overrides for `enabled`

## Decisions

### Filter at job generation (Approach A)
Add the `enabled` check in `JobGenerator.collectReviewJobs()` alongside the existing `shouldRunGate()` call. This follows the established pattern — `run_in_ci`/`run_locally` are already filtered at the same point.

The `enableReviews` set is threaded from CLI options → `ExecuteRunOptions` → `JobGenerator` constructor.

### Schema: `enabled` defaults to `true`
All three review schemas (`reviewGateSchema`, `reviewPromptFrontmatterSchema`, `reviewYamlSchema`) get `enabled: z.boolean().default(true)`. This ensures zero impact on existing review configs — only reviews that explicitly set `enabled: false` become opt-in.

### CLI: repeatable `--enable-review`
Commander's `<name...>` variadic syntax collects multiple values: `--enable-review task-compliance --enable-review security`. Short flag: `-e`.

### Skill awareness via task context file
Both gauntlet-run skills check for `.gauntlet/current-task-context.md`. If it exists, append `--enable-review task-compliance` to the run command. This is the existing pattern — the task context file is already written by implementer subagents.

## Risks / Trade-offs

- **Risk**: Passing `--enable-review` with a name that doesn't match any review config silently does nothing. This is acceptable — it follows the same pattern as `--gate` with an unknown name.
- **Trade-off**: No `--disable-review` inverse. YAGNI — if needed later, it can be added independently.

## Migration Plan

1. Ship schema + CLI + job generation changes together
2. Set `enabled: false` in task-compliance frontmatter in both projects
3. Update both gauntlet-run skills to pass `--enable-review task-compliance` when task context exists
4. Update flokay implementer prompt

No breaking changes — existing configs with no `enabled` field default to `true`.

## Open Questions

None — all design decisions resolved during review.
