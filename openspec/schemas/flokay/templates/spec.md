<!--
  SPEC TEMPLATE

  Create one spec file per capability listed in the proposal's Capabilities section.
  - New capabilities: use the exact kebab-case name from the proposal (specs/<capability>/spec.md).
  - Modified capabilities: use the existing spec folder name from openspec/specs/<capability>/
    when creating the delta spec at specs/<capability>/spec.md.

  Input sources: Read both the proposal (for capability names and motivation) and the
  design (for behavioral detail). The proposal tells you WHICH capabilities to spec; the
  design tells you HOW they behave. Most of your scenario detail will come from design
  decisions, not the proposal.

  Delta operations (use ## headers):
  - ADDED Requirements — New capabilities
  - MODIFIED Requirements — Changed behavior. MUST include full updated content.
  - REMOVED Requirements — Deprecated features. MUST include Reason and Migration.
  - RENAMED Requirements — Name changes only. Use FROM:/TO: format.

  Format rules:
  - Each requirement: `### Requirement: <name>` followed by description
  - Use SHALL/MUST for normative requirements (avoid should/may)
  - Each scenario: `#### Scenario: <name>` with WHEN/THEN format
  - CRITICAL: Scenarios MUST use exactly 4 hashtags (####). Using 3 or bullets will fail silently.
  - Every requirement MUST have at least one scenario.

  Abstraction level: Scenarios describe observable behavioral contracts — what the
  system does when invoked under specific conditions. Focus on orchestration behavior
  (dispatch, gating, error handling, control flow), NOT file contents or internal structure.

  Write scenarios as behavioral contracts the capability guarantees to its callers:
  - GOOD: "WHEN subagent finds task ambiguous THEN it returns questions without implementing"
  - GOOD: "WHEN gauntlet retry limit is exhausted THEN subagent returns failure to coordinator"
  - BAD:  "WHEN SKILL.md is read THEN it contains TDD instructions"
  - BAD:  "WHEN config file exists THEN it has the correct YAML keys"

  MODIFIED requirements workflow:
  1. Locate the existing requirement in openspec/specs/<capability>/spec.md
  2. Copy the ENTIRE requirement block (from `### Requirement:` through all scenarios)
  3. Paste under `## MODIFIED Requirements` and edit to reflect new behavior
  4. Ensure header text matches exactly (whitespace-insensitive)

  Common pitfall: Using MODIFIED with partial content loses detail at archive time.
  If adding new concerns without changing existing behavior, use ADDED instead.

  Specs should be verifiable — each scenario is a potential test case or review
  checkpoint. For code changes, scenarios map to automated tests. For infrastructure
  and skill changes, scenarios serve as acceptance criteria verified during review.
-->

## ADDED Requirements

### Requirement: <!-- requirement name -->
<!-- requirement text -->

#### Scenario: <!-- scenario name -->
- **WHEN** <!-- condition -->
- **THEN** <!-- expected outcome -->

<!--
  Example of additional delta sections:

  ## REMOVED Requirements

  ### Requirement: Legacy export
  **Reason**: Replaced by new export system
  **Migration**: Use new export endpoint at /api/v2/export
-->
