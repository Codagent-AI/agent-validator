## MODIFIED Requirements

### Requirement: Round-Robin Review Dispatch
The review gate MUST assign reviews to adapters using round-robin over the list of healthy adapters from the configured preference order. The review index is the 1-based position in the dispatch order (1 through `num_reviews`). The system SHALL NOT error when `num_reviews` exceeds the number of available adapters. Adapter health is determined by binary availability and cooldown status (as defined in the Adapter Cooldown and Recovery requirement in the run-lifecycle spec).

#### Scenario: All adapters healthy
- **GIVEN** `cli_preference: [claude, codex, gemini]` and `num_reviews: 3`
- **AND** all three adapters are healthy (binary available, not cooling down)
- **WHEN** the review gate dispatches reviews
- **THEN** assignments SHALL be `[(1, claude), (2, codex), (3, gemini)]` with review indices 1-3

#### Scenario: Some adapters unavailable
- **GIVEN** `cli_preference: [claude, codex, gemini]` and `num_reviews: 3`
- **AND** codex is unavailable (binary missing or cooling down)
- **WHEN** the review gate dispatches reviews
- **THEN** assignments SHALL be `[(1, claude), (2, gemini), (3, claude)]` (round-robin over healthy adapters)

#### Scenario: Single adapter available
- **GIVEN** `cli_preference: [claude, codex, gemini]` and `num_reviews: 3`
- **AND** only claude is healthy
- **WHEN** the review gate dispatches reviews
- **THEN** assignments SHALL be `[(1, claude), (2, claude), (3, claude)]`

#### Scenario: No adapters available
- **GIVEN** `cli_preference: [claude, codex, gemini]` and `num_reviews: 2`
- **AND** no adapters are healthy (all missing or cooling down)
- **WHEN** the review gate dispatches reviews
- **THEN** the gate SHALL return an error status
- **AND** the error message SHALL include the text "no healthy adapters"

## REMOVED Requirements

### Requirement: Preflight Phase
**Reason**: Preflight checks are removed. Command-existence checks for check gates are redundant (execution-time failures produce clear errors). Adapter health probes are replaced by runtime usage-limit detection and cooldown tracking.
**Migration**: No user action required. The system no longer runs a preflight phase. Check gates that reference missing commands will fail at execution time with a clear error message. Adapter usage limits are detected from actual review output.
