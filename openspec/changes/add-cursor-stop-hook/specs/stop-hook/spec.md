## ADDED Requirements

### Requirement: Multi-Protocol Support

The stop-hook command MUST support multiple IDE protocols through an adapter-based architecture, detecting the protocol from stdin input and delegating to the appropriate adapter.

#### Scenario: Cursor protocol detection
- **GIVEN** the stop-hook receives stdin JSON containing `cursor_version` field
- **WHEN** the command processes the input
- **THEN** it SHALL use the Cursor protocol adapter
- **AND** it SHALL parse Cursor-specific fields (`status`, `loop_count`, `workspace_roots`)

#### Scenario: Claude Code protocol detection
- **GIVEN** the stop-hook receives stdin JSON without `cursor_version` field
- **WHEN** the command processes the input
- **THEN** it SHALL use the Claude Code protocol adapter
- **AND** it SHALL parse Claude-specific fields (`stop_hook_active`, `cwd`, `session_id`)

#### Scenario: Empty or invalid input defaults to Claude
- **GIVEN** the stop-hook receives empty stdin or invalid JSON
- **WHEN** the command attempts to detect protocol
- **THEN** it SHALL default to Claude Code protocol adapter
- **AND** it SHALL handle the input per existing Claude behavior

### Requirement: Cursor Protocol Output Format

When using the Cursor protocol, the stop-hook MUST output responses in Cursor's expected format using `followup_message` for continuation.

#### Scenario: Blocking response for Cursor (failed status)
- **GIVEN** gates have failed and the protocol is Cursor
- **WHEN** the stop-hook outputs the decision
- **THEN** the JSON SHALL include a `followup_message` field with fix instructions
- **AND** the format SHALL be `{ "followup_message": "<instructions>" }`

#### Scenario: Blocking response for Cursor (pr_push_required status)
- **GIVEN** gates have passed but PR needs to be created/updated and the protocol is Cursor
- **AND** the status is `pr_push_required`
- **WHEN** the stop-hook outputs the decision
- **THEN** the JSON SHALL include a `followup_message` field with push-PR instructions
- **AND** the format SHALL be `{ "followup_message": "<push-pr-instructions>" }`

#### Scenario: Allowing response for Cursor
- **GIVEN** gates have passed (or other non-blocking status) and the protocol is Cursor
- **AND** the status is NOT `pr_push_required`
- **WHEN** the stop-hook outputs the decision
- **THEN** the JSON SHALL be an empty object `{}`
- **AND** no `followup_message` field SHALL be present

### Requirement: Cursor Loop Count Handling

The stop-hook MUST handle Cursor's `loop_count` field to prevent excessive retry loops.

#### Scenario: Loop count below threshold
- **GIVEN** the Cursor input has `loop_count` less than the configured threshold
- **WHEN** the stop-hook evaluates whether to skip execution
- **THEN** it SHALL proceed with gauntlet execution normally

#### Scenario: Loop count at or above threshold
- **GIVEN** the Cursor input has `loop_count` at or above the configured threshold (default 10)
- **WHEN** the stop-hook evaluates whether to skip execution
- **THEN** it SHALL return an empty response to allow stop
- **AND** it SHALL NOT invoke the gauntlet
- **AND** this SHALL behave similarly to `retry_limit_exceeded` status

### Requirement: Adapter Interface

The system MUST define a `StopHookAdapter` interface that protocol-specific implementations conform to.

#### Scenario: Adapter detection method
- **GIVEN** a `StopHookAdapter` implementation
- **WHEN** `detect(raw)` is called with parsed stdin JSON
- **THEN** it SHALL return `true` if the input matches this adapter's protocol
- **AND** it SHALL return `false` otherwise

#### Scenario: Adapter input parsing
- **GIVEN** a `StopHookAdapter` implementation
- **WHEN** `parseInput(raw)` is called with parsed stdin JSON
- **THEN** it SHALL return a `StopHookContext` with protocol-agnostic fields
- **AND** the context SHALL include `cwd`, `isNestedHook`, and optional `loopCount`

#### Scenario: Adapter output formatting
- **GIVEN** a `StopHookAdapter` implementation and a `StopHookResult`
- **WHEN** `formatOutput(result)` is called
- **THEN** it SHALL return a JSON string in the protocol's expected format
- **AND** for blocking status `failed`, it SHALL use `result.instructions`
- **AND** for blocking status `pr_push_required`, it SHALL use `result.pushPRReason`

#### Scenario: Adapter early exit check
- **GIVEN** a `StopHookAdapter` implementation and a `StopHookContext`
- **WHEN** `shouldSkipExecution(ctx)` is called
- **THEN** it SHALL return a `StopHookResult` if execution should be skipped
- **AND** it SHALL return `null` if execution should proceed

### Requirement: PR Push Required Status Handling

Both Claude Code and Cursor adapters MUST handle the `pr_push_required` status returned by the handler when `auto_push_pr` is enabled and gates pass but no PR exists or PR is not up to date.

#### Scenario: Claude Code adapter handles pr_push_required
- **GIVEN** the handler returns status `pr_push_required` with `pushPRReason`
- **AND** the protocol is Claude Code
- **WHEN** `formatOutput(result)` is called
- **THEN** the response SHALL have `decision: "block"`
- **AND** `reason` SHALL contain the `pushPRReason` instructions
- **AND** `stopReason` SHALL contain the `pushPRReason` instructions

#### Scenario: Cursor adapter handles pr_push_required
- **GIVEN** the handler returns status `pr_push_required` with `pushPRReason`
- **AND** the protocol is Cursor
- **WHEN** `formatOutput(result)` is called
- **THEN** the response SHALL be `{ "followup_message": "<pushPRReason>" }`
