## REMOVED Requirements

### Requirement: Stop Hook Protocol Compliance
**Reason**: Stop hook feature removed entirely. Being replaced by an agent runner tool.
**Migration**: None required. The agent runner tool will provide equivalent enforcement.

### Requirement: Infinite Loop Prevention
**Reason**: Stop hook feature removed entirely.
**Migration**: N/A — no stop hook means no loop prevention needed.

### Requirement: Gauntlet Project Detection
**Reason**: Stop hook feature removed entirely.
**Migration**: Project detection for gauntlet enforcement will be handled by the agent runner.

### Requirement: Gauntlet Execution
**Reason**: Stop hook feature removed entirely.
**Migration**: Gate execution orchestration will be handled by the agent runner.

### Requirement: Status-Based Decision Making
**Reason**: Stop hook feature removed entirely.
**Migration**: N/A.

### Requirement: Block Decision Output
**Reason**: Stop hook feature removed entirely.
**Migration**: N/A.

### Requirement: Execution State Tracking
**Reason**: Stop hook feature removed entirely. Execution state tracking that supports the run lifecycle (fixBase, auto-clean) is retained in the run-lifecycle spec.
**Migration**: N/A.

### Requirement: Automatic Log Cleaning on Context Change
**Reason**: Stop hook feature removed entirely. Auto-clean behavior is retained in the run-lifecycle spec where it applies to CLI commands.
**Migration**: N/A.

### Requirement: Global Configuration
**Reason**: Stop hook feature removed entirely. The `stop_hook` section of global config is no longer needed.
**Migration**: Remove `stop_hook` from global config schema. Existing config files with this section will be silently ignored.

### Requirement: Stop Hook Run Interval
**Reason**: Stop hook feature removed entirely.
**Migration**: N/A.

### Requirement: Enhanced Stop Reason Instructions
**Reason**: Stop hook feature removed entirely.
**Migration**: N/A.

### Requirement: Structured JSON Response for All Outcomes
**Reason**: Stop hook feature removed entirely.
**Migration**: N/A.

### Requirement: Status Codes for Approval Scenarios
**Reason**: Stop hook feature removed entirely.
**Migration**: N/A.

### Requirement: Stop Hook Status Messages
**Reason**: Stop hook feature removed entirely.
**Migration**: N/A.

### Requirement: Stop Hook Configuration Resolution
**Reason**: Stop hook feature removed entirely.
**Migration**: N/A.

### Requirement: Child Process Debug Logging Suppression
**Reason**: Stop hook feature removed entirely.
**Migration**: N/A.

### Requirement: Simplified Stop Hook Flow
**Reason**: Stop hook feature removed entirely.
**Migration**: N/A.

### Requirement: Multi-Protocol Support
**Reason**: Stop hook feature removed entirely.
**Migration**: N/A.

### Requirement: Cursor Protocol Output Format
**Reason**: Stop hook feature removed entirely.
**Migration**: N/A.

### Requirement: Cursor Loop Count Handling
**Reason**: Stop hook feature removed entirely.
**Migration**: N/A.

### Requirement: Adapter Interface
**Reason**: Stop hook feature removed entirely.
**Migration**: N/A.

### Requirement: Adapter Protocol Validation Required Status Handling
**Reason**: Stop hook feature removed entirely.
**Migration**: N/A.

### Requirement: Validation Required Status
**Reason**: Stop hook feature removed entirely.
**Migration**: N/A.

### Requirement: Stop Hook State Reading
**Reason**: Stop hook feature removed entirely.
**Migration**: N/A.
