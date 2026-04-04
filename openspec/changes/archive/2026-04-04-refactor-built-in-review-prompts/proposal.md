## Why

The built-in code-quality review prompt depends on external pr-review-toolkit agents (code-reviewer, silent-failure-hunter, type-design-analyzer) with an inline fallback, adding complexity for no benefit since the toolkit is never reliably available. Research from SWR-Bench (arXiv 2509.01494), CodeX-Verify (arXiv 2511.16708), and Meta's semi-formal reasoning work (arXiv 2603.01896) shows that (a) multi-review aggregation boosts F1 by up to 43.67%, (b) specialized agents improve detection by 39.7pp over single-agent, and (c) execution-tracing prompts push accuracy from 78% to 93%. The current prompt uses none of these techniques.

## What Changes

- **Remove pr-review-toolkit dependency** from the code-quality prompt. The prompt becomes fully self-contained with no agent dispatch logic or fallback patterns.
- **Rewrite code-quality prompt** using research-backed techniques: semi-formal reasoning (require precondition/execution-trace/failure-outcome before reporting), flat category checklist instead of the three-lens/agent structure, and removal of the "senior software engineer" persona (shown to hurt performance vs. no persona).
- **Add two new built-in review prompts** (`security` and `error-handling`) as specialized passes covering areas where independent reviewers catch fundamentally different bug categories with low correlation to the general code-quality reviewer.
- **Update `init` command** to present a multi-select of all available built-in reviews, with all three pre-selected by default. Users can deselect any they don't want.
- **Update the built-in review registry** (`src/built-in-reviews/index.ts`) to register the new prompts.

## Capabilities

### New Capabilities
- `builtin-security-review`: A focused security review prompt covering injection, auth/authz, secrets exposure, input validation, and OWASP top-10 categories. Designed to run as an independent review pass.
- `builtin-error-handling-review`: A focused error-handling review prompt covering swallowed errors, missing observability, inadequate error propagation, and silent failure modes. Designed to run as an independent review pass.
- `thorough-review-init`: The `init` command presents a multi-select of all available built-in reviews (code-quality, security, error-handling), all pre-selected by default. Users deselect to opt out.

### Modified Capabilities
- `review-config`: The built-in code-quality prompt content changes. The scenario "Built-in code-quality prompt content" must be updated to remove pr-review-toolkit references and describe the new self-contained prompt structure with semi-formal reasoning requirements.

## Impact

- **`src/built-in-reviews/code-quality.md`** — rewritten (no pr-review-toolkit, add execution-tracing requirement)
- **`src/built-in-reviews/security.md`** — new file
- **`src/built-in-reviews/error-handling.md`** — new file
- **`src/built-in-reviews/index.ts`** — register two new built-ins
- **`src/commands/init.ts`** — add thorough review option
- **`openspec/specs/review-config/spec.md`** — update built-in prompt content scenarios
- No breaking changes to config schema — new built-ins are opt-in via existing `builtin:` config attribute
- No changes to review execution, aggregation, or evaluation logic
