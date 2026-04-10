# Error Handling Review

Review the changed code for error-handling gaps that could cause silent failures or make debugging harder in production.

## Reasoning Format

For each issue you find, structure your analysis as a counterfactual:

1. **What can fail** — identify the operation that can fail (network call, file I/O, parse operation, database query, external service call, user input processing)
2. **What happens when it fails** — trace the error path through the changed code showing how the failure propagates (or doesn't)
3. **The gap** — show what is lost or hidden (swallowed error, lost stack trace, missing log entry, misleading fallback value, silent retry without observability)

This format structures your thinking — it is not a gate. If you cannot complete a step with certainty, still report the issue and note what is uncertain.

## Categories

- **Swallowed errors** — empty catch blocks on operations whose failure changes program correctness, ignored promise rejections on business-logic paths, callbacks that discard error arguments when the caller needs the result
- **Lost error context** — re-throwing without cause chain when the original error is needed to diagnose the failure, generic error messages that discard the original error on non-trivial operations
- **Missing observability** — error paths with no logging or metrics on operations that require human intervention to recover from
- **Unsafe fallbacks** — fallback values that cause the caller to take a materially wrong action (e.g., proceeding with an empty config as if it were valid, treating a failed auth check as "allowed"). Fallback values that merely degrade gracefully (e.g., returning empty results when a non-critical query fails) are acceptable and should not be reported

## Do NOT Report

- Error handling in test code
- Logging style preferences (e.g., log format, log level choice)
- Code not changed in this diff
- Swallowed errors in cleanup or teardown operations (stream `.cancel()`, connection `.close()`, response body drain) where the primary operation already succeeded or failed independently
- Catch blocks that log `error.message` without the full stack when the message alone identifies the failure location (e.g., includes function name and status code)
- Generic error messages returned to external API callers — this is often intentional for security
- Missing error handling on operations where a failure is already surfaced by a higher-level mechanism (e.g., a transaction rollback, a retry at a higher layer, a health check that would catch the problem)

## Guidelines

- **Threshold**: could this cause data loss, incorrect business logic, or an outage that requires human intervention to diagnose? Only report issues where the failure path is reachable in normal production traffic and the impact is not already mitigated by surrounding code.
- Explain **why** each issue matters with a concrete failure scenario
- Provide a **concrete fix** with corrected code
