## Why

Reviews like `task-compliance` are only meaningful when there's an active task context, but they currently run unconditionally — wasting time and CLI credits on every gauntlet invocation. We need a way to define reviews as opt-in so they only execute when explicitly activated.

## What Changes

- Add `enabled` attribute to review config frontmatter (`.md` and `.yml`/`.yaml`) — defaults to `true`, set to `false` to make a review opt-in
- Add `--enable-review <name>` CLI option to `run` and `review` commands to activate disabled reviews at runtime (repeatable for multiple reviews)
- Update both copies of the `gauntlet-run` skill to pass `--enable-review` when task context is present
- (External, tracked separately) Update flokay's implementer prompt to use `--enable-review task-compliance`

## Capabilities

### New Capabilities
- `dynamic-review-control`: Per-review `enabled` flag with CLI override to selectively activate disabled reviews at runtime

### Modified Capabilities
- `review-config`: Add `enabled` boolean attribute (default `true`) to review frontmatter and YAML schemas, and filter disabled reviews during job generation
- `agent-command`: Add `--enable-review <name>` repeatable option to `run` and `review` commands

## Impact

- **Config schema**: `reviewPromptFrontmatterSchema`, `reviewYamlSchema`, `reviewGateSchema` in `src/config/schema.ts` — add `enabled` field
- **Config types**: `LoadedReviewGateConfig` in `src/config/types.ts` — add `enabled` property
- **Validation**: `src/config/validate-reviews.ts` — propagate `enabled` through loading
- **Job generation**: `src/core/job.ts` — filter out disabled reviews unless overridden via CLI
- **CLI commands**: `src/commands/run.ts`, `src/commands/review.ts` — add `--enable-review` option
- **Skills**: `.claude/skills/gauntlet-run/SKILL.md` and `skills/gauntlet-run/SKILL.md` — conditional `--enable-review` flag
- **External (flokay project, tracked separately)**: `skills/implement-task/implementer-prompt.md` — gauntlet integration instructions
