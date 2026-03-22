## REMOVED Requirements

### Requirement: Start Hook Command
**Reason**: Start hook removed along with the stop hook feature. Context injection at session start will be handled by the agent runner replacement.
**Migration**: The SessionStart hook in plugin hooks.json that invoked `agent-gauntlet start-hook` will be removed. The start-hook CLI command will be deleted.

### Requirement: Start Hook Context Message
**Reason**: Start hook removed along with the stop hook feature.
**Migration**: N/A.

### Requirement: Start Hook Protocol Support
**Reason**: Start hook removed along with the stop hook feature.
**Migration**: N/A.

### Requirement: Start Hook Simplicity
**Reason**: Start hook removed along with the stop hook feature.
**Migration**: N/A.
