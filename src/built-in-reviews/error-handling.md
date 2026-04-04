# Error Handling Review

Review the changed code for error-handling gaps that could cause silent failures or make debugging harder in production.

## Reasoning Format

For each issue you find, structure your analysis as a counterfactual:

1. **What can fail** — identify the operation that can fail (network call, file I/O, parse operation, database query, external service call, user input processing)
2. **What happens when it fails** — trace the error path through the changed code showing how the failure propagates (or doesn't)
3. **The gap** — show what is lost or hidden (swallowed error, lost stack trace, missing log entry, misleading fallback value, silent retry without observability)

This format structures your thinking — it is not a gate. If you cannot complete a step with certainty, still report the issue and note what is uncertain.

## Categories

- **Swallowed errors** — empty catch blocks, catch-and-return-default without logging, ignored promise rejections, callbacks that discard error arguments
- **Lost error context** — re-throwing without cause chain, generic error messages that discard the original error, catch blocks that log only the message without the stack
- **Missing observability** — error paths with no logging or metrics, failures that propagate silently through return values, operations that can fail without any alerting path
- **Unsafe fallbacks** — fallback values that mask bugs rather than fail visibly (e.g., returning empty array on parse failure), retry logic without backoff or limits, default values that silently change behavior when the real value fails to load

## Do NOT Report

- Error handling in test code
- Logging style preferences (e.g., log format, log level choice)
- Code not changed in this diff

## Guidelines

- **Threshold**: could this cause a silent failure or make debugging harder in production? When uncertain, report it.
- Explain **why** each issue matters with a concrete failure scenario
- Provide a **concrete fix** with corrected code
