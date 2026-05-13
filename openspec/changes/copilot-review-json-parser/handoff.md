# Handoff: Copilot Review JSON Parser Failure

## Objective

Diagnose and fix the `agent-validator` review gate failure where the `github-copilot` reviewer emits a valid JSON review object after Copilot tool-read transcript lines, but Agent Validator reports `No valid JSON object found in output`.

## Current State

`agent-runner` validation passed cleanly with `agent-validate run`.

`agent-validator` validation ended with `Status: Error`:
- `check:.:lint` failed on import ordering in `src/cli-adapters/github-copilot.ts`.
- `review:.:all-reviewers (github-copilot@1)` failed with `No valid JSON object found in output`.

The Copilot review log at `validator_logs/review_._all-reviewers_github-copilot@1.1.log` contains tool-read transcript lines followed by a valid JSON object:

```json
{"status":"fail","violations":[...]}
```

So the immediate parser failure is an Agent Validator bug or integration gap: it should either extract the valid trailing JSON object despite Copilot's transcript preamble, or invoke Copilot in a mode that suppresses those transcript lines.

While investigating, two high-priority Copilot review findings were also surfaced against unrelated dirty work in `src/cli-adapters/github-copilot.ts`:
- Large prompt/diff payloads are passed through `--prompt`, risking `E2BIG` / command-length failures.
- `runPromptStreaming()` treats `code === null` as success and can accept signaled exits as valid partial output.

I started fixing those unrelated findings locally in `src/cli-adapters/github-copilot.ts`, but those changes are intentionally uncommitted per the user's instruction not to commit unrelated work.

## Key Decisions

- **Do not commit unrelated Copilot adapter fixes** — The user explicitly asked to make applicable fixes to unrelated changes but not commit them.
- **Treat the parser failure as a validator bug** — The log contains a valid JSON review object, but parsing failed because non-JSON Copilot transcript text preceded it.

## Open Questions

- Should the parser become more tolerant by extracting the last complete JSON object from noisy output, or should the Copilot adapter force cleaner output from the CLI?
- Should Copilot adapter fixes for large prompts and signaled exits be split into a separate PR from the Homebrew release automation?

## Next Steps

1. Inspect the review output parsing code used after adapter execution, likely in `src/gates/review.ts` or adjacent review parser utilities.
2. Add a regression test with Copilot-style transcript text followed by valid JSON.
3. Fix parsing or adapter invocation so the test passes.
4. Finish or revert the in-progress unrelated edits in `src/cli-adapters/github-copilot.ts` according to the user's preferred branch/PR split.
5. Rerun `agent-validate run` in `agent-validator`.

## Relevant Files

- `validator_logs/review_._all-reviewers_github-copilot@1.1.log`
- `validator_logs/check_._lint.1.log`
- `src/cli-adapters/github-copilot.ts`
- `test/cli-adapters/copilot-plugin.test.ts`
- `src/gates/review.ts`
