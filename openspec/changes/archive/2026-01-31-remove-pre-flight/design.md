## Context
The preflight phase currently performs two types of checks before gate execution:
1. **Command existence checks** for check gates (e.g. `which bun`, `which tsc`)
2. **Adapter health probes** for review gates (optionally including a "hello" prompt to detect usage limits)

Both are redundant: command failures produce clear errors at execution time, and usage limits can be detected from actual review output. The preflight phase adds latency and wastes tokens.

## Goals / Non-Goals
- Goals:
  - Eliminate all preflight overhead (zero additional prompts before real work)
  - Detect usage limits from actual review adapter output
  - Track unhealthy adapters persistently with a 1-hour cooldown
  - Improve code health of `runner.ts` by removing its largest, most complex method
- Non-Goals:
  - Proactive rate-limit detection before any review runs (this is what we're removing)
  - Health monitoring dashboard or detailed adapter metrics

## Decisions
- **Adapter health state in `.execution_state`**: Store `unhealthy_adapters` as an optional field in the existing execution state file rather than creating a separate file. This keeps the state co-located and preserves existing cleanup semantics (state resets on branch change, merged commit, etc.).
- **1-hour cooldown**: Unhealthy adapters are skipped for 1 hour. After the cooldown expires, the next run that would use the adapter performs a lightweight availability check (binary exists) and clears the unhealthy flag if the binary is present. No "hello" prompt is sent.
- **Detection point**: Usage limits are detected in `runSingleReview` after `adapter.execute()` returns or throws. The existing `isUsageLimit()` function is reused.
- **Error propagation**: A usage-limit detection marks the review slot as `status: "error"` with a descriptive message. The adapter is marked unhealthy in execution state. The gate continues with other adapters/slots.

## Pre-factoring
Two files touched by this change are CodeScene hotspots:

### `src/core/runner.ts` (Code Health: 6.65)
- **`Runner.preflight`** (cc=27, 109 LoC): Bumpy Road, Deep Nested Complexity, Complex Method, Large Method. This function is being **deleted entirely**, which resolves all its code smells and is the primary improvement to this file's code health.
- **`calculateStats`** (cc=14): Bumpy Road, Deep Nested Complexity. Not touched by this change.
- **`Runner.executeJob`** (cc=13): Complex Method. Minor change (remove `checkUsageLimit` param pass-through). No refactoring needed.

### `src/gates/review.ts` (Code Health: 7.2)
- **`ReviewGateExecutor.getDiff`** (cc=25, 95 LoC): Bumpy Road, Complex Method, Large Method. Not touched by this change.
- **`ReviewGateExecutor.runSingleReview`**: Will be modified to add usage-limit detection. The addition is a simple conditional at the end of the try block (after `adapter.execute()`), not increasing nesting depth.
- **`ReviewGateExecutor.execute`**: Will be modified to replace preflight health checks with cooldown-based filtering. This simplifies the method by removing the `checkUsageLimit` parameter threading.

No pre-factoring is required because: (1) the worst offender (`Runner.preflight`) is being deleted, and (2) the modifications to `review.ts` don't increase complexity of already-complex functions.

## Risks / Trade-offs
- **Risk**: First review after a usage limit may waste a full review prompt's worth of tokens before detecting the limit.
  - Mitigation: This is one prompt vs. the current approach of sending N throwaway "hello" prompts on every run. Net token savings are positive.
- **Risk**: Stale unhealthy state if execution state is manually edited or corrupted.
  - Mitigation: The 1-hour cooldown is self-healing. Invalid timestamps default to "expired" (adapter retried).

## Open Questions
None.
