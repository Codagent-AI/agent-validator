## Context

The init flow currently asks users to select built-in review prompts via a multi-select checkbox (`promptBuiltInReviews`). This adds friction without value — the optimal config depends on which reviewer CLI is available. The README already documents preferred configurations based on CLI availability (primary: Copilot hybrid, secondary: Codex all-reviewers, fallback: all-reviewers without overrides).

## Goals / Non-Goals

**Goals:**
- Automatically select the right review configuration based on chosen reviewer CLIs
- Emit per-review `cli_preference` and `model` overrides matching README recommendations
- Print a human-readable explanation of what was configured

**Non-Goals:**
- Changing the review CLI selection prompt (`promptReviewCLIs`) — that stays as-is
- Adding new built-in review prompts
- Changing how reviews are loaded or executed at runtime

## Approach

All changes are in `src/commands/init.ts` and `src/commands/init-prompts.ts`.

### New type and function in `init.ts`

```typescript
type ReviewEntry = {
  name: string;
  builtin: string;
  cli_preference?: string[];
  model?: string;
};

type ReviewConfig = {
  type: 'primary' | 'secondary' | 'fallback';
  reviews: ReviewEntry[];
};

function selectReviewConfig(reviewCLINames: string[]): ReviewConfig
```

Pure function, no I/O. Priority logic:
1. `reviewCLINames` includes `github-copilot` → primary (code-quality with Sonnet + security-and-errors with GPT)
2. `reviewCLINames` includes `codex` → secondary (all-reviewers with GPT)
3. Otherwise → fallback (all-reviewers, no overrides)

### Changes to `runInit`

Replace:
```typescript
const selectedBuiltIns = await promptBuiltInReviews(skipPrompts);
```

With:
```typescript
const reviewConfig = selectReviewConfig(reviewCLINames);
printReviewConfigExplanation(reviewConfig);
```

Pass `reviewConfig` through `scaffoldValidatorDir` to `writeConfigYml` instead of `selectedBuiltIns`.

### Changes to `writeConfigYml`

Replace the `selectedBuiltIns: string[]` parameter with `reviewConfig: ReviewConfig`. Generate review comment hints from `reviewConfig.reviews`, including `builtin`, `cli_preference`, and `model` fields per entry.

### New function: `printReviewConfigExplanation`

Prints a brief message explaining which config was selected:
- Primary: mentions two-pass hybrid, Copilot + Sonnet for code-quality, GPT for security+errors
- Secondary: mentions all-reviewers combined pass via Codex
- Fallback: mentions all-reviewers combined prompt

### `CLI_PREFERENCE_ORDER` update

Move `github-copilot` to first position (before `codex`).

### Deletions in `init-prompts.ts`

- Remove `promptBuiltInReviews` function
- Remove `getBuiltInReviewNames` import

## Decisions

| Decision | Rationale |
|----------|-----------|
| Pure function for recommendation logic | Testable without I/O, easy to extend with new CLI priorities later |
| Keep in `init.ts` rather than new module | Only ~20 lines of logic, not enough to warrant a new file |
| Type union for ReviewConfig | Makes the three config variants explicit and exhaustive |

## Risks / Trade-offs

- **Hardcoded model names** (`claude-sonnet-4.6`, `gpt-5.3-codex`): These match the README's eval-backed recommendations. If models change, both README and this logic need updating. Acceptable since these are already hardcoded in `ADAPTER_CONFIG`.
- **No user override during init**: Users who want a different config must edit `config.yml` after init. This is intentional — init optimizes for the common case.
