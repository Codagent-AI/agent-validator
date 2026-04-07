## Why

The init flow currently asks users to manually select which built-in review prompts to enable (code-quality, security, error-handling) via a multi-select checkbox. This adds friction without adding value — most users don't yet understand the trade-offs between individual reviews vs. the combined "all-reviewers" prompt, and the optimal configuration depends on which reviewer CLI they're using (Copilot vs Codex vs others). The init command should make an opinionated recommendation based on the detected reviewer CLI, reducing decision fatigue and steering users toward the configuration that works best for their setup.

## What Changes

- **Remove the `promptBuiltInReviews()` question** from the init flow. Users will no longer be asked to individually select which built-in review prompts to enable.
- **Add reviewer-aware recommendation logic** that selects the best default configuration based on the chosen review CLI:
  - **GitHub Copilot available → recommend as preferred reviewer.** Uses the "preferred" config: the combined `all-reviewers` built-in prompt (single review pass covering code-quality, security, and error-handling together).
  - **GitHub Copilot not available, Codex available → recommend Codex as secondary reviewer.** Uses the "secondary" config: three separate built-in review prompts (`code-quality`, `security`, `error-handling`) run as independent passes.
  - **Neither Copilot nor Codex → fall back to current behavior** with all three individual reviews enabled (same as today's default selection).
- **Update `writeConfigYml()`** to emit the correct inline review entries (or comment hints) based on which configuration was recommended and accepted.
- **Update `CLI_PREFERENCE_ORDER`** to reflect that `github-copilot` is now the preferred reviewer (currently `codex` is first).

## Capabilities

### New Capabilities
- `init-reviewer-recommendation`: Logic for detecting available reviewer CLIs and recommending the optimal reviewer + review configuration during init. Covers the recommendation prompt, fallback chain (Copilot → Codex → all-three), and mapping each choice to its review config.

### Modified Capabilities
- `init-config`: Init will no longer prompt for individual built-in review selection. Config generation changes to emit either a single `all-reviewers` entry or three individual entries depending on the recommended/selected reviewer.

## Impact

- `src/commands/init.ts` — Remove `promptBuiltInReviews()` call, add recommendation logic, update `writeConfigYml()` to handle preferred/secondary/fallback configs, reorder `CLI_PREFERENCE_ORDER`
- `src/commands/init-prompts.ts` — Remove `promptBuiltInReviews()` function export, add new recommendation prompt function
- `src/built-in-reviews/index.ts` — No changes expected (combined reviews already exist)
- Existing specs `init-config` and `review-config` — `init-config` spec scenarios around built-in review selection will need updating
