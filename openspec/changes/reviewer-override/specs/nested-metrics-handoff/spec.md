## ADDED Requirements

### Requirement: Capabilities advertise reviewer-override support
`metrics capabilities` SHALL advertise reviewer-override support on the existing capabilities document with `capabilities_version` remaining `1` and `reviewer_override: { "supported": true }`. This advertisement is bootstrap feature detection for callers such as Runner. It SHALL NOT require project configuration, create storage, inspect reviewer environment variables, or change export, acknowledgment, discard, pending inventory, measurement schemas, protocol version, or artifact version.

Adding `reviewer_override` while keeping `capabilities_version` `1` is an explicit exception to the published closed v1 capabilities schema: this envelope MAY grow additive bootstrap feature flags. It is not a measurement, protocol, or artifact schema change. The published v1 capabilities schema and fixtures SHALL include the flag. Current Agent Runner ignores unknown JSON keys and requires `capabilities_version == 1`; it SHALL continue to accept the document. A Validator that omits `reviewer_override.supported` SHALL be treated by new Runner as lacking the override (Runner behavior). Validator itself SHALL emit the flag whenever this change is present.

#### Scenario: Capabilities includes reviewer_override without a project
- **WHEN** `metrics capabilities` is invoked with no project configuration
- **THEN** the JSON response SHALL include `capabilities_version` `1` and `reviewer_override.supported` true
- **AND** the command SHALL create no storage

#### Scenario: Capabilities does not depend on reviewer env
- **WHEN** `metrics capabilities` is invoked with or without reviewer override environment variables
- **THEN** the response SHALL still advertise `reviewer_override.supported` true
- **AND** it SHALL NOT enable, apply, or validate the override

#### Scenario: Metrics data operations are unchanged
- **WHEN** a caller invokes `metrics export`, `acknowledge`, `discard`, or `pending`
- **THEN** those operations SHALL behave as specified by the existing nested-metrics-handoff retrieval contract
- **AND** they SHALL NOT interpret `reviewer_override` as a measurement or delivery field
