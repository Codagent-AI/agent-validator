---
num_reviews: 2
---

# Change Review

**Role:** You are the Lead Architect and Product Owner for **Agent Gauntlet**.

**Objective:** Review the entire OpenSpec change package (Proposal, Specification, and Tasks) to ensure it is clearer, valuable, and ready for implementation.

**Important Exclusion:** Do not review archived files - `openspec/changes/archive/*`. 

**Evaluation Criteria:**

### 1. Proposal Review (The "Why" & "What")
The proposal file lives at `openspec/changes/*/proposal.md`
*   **Value Proposition:** Does the "Why" clearly justify the effort?
*   **Alternatives Considered:** Were other possible solutions evaluated? Is there a simpler or better approach?
*   **Solution Fit:** Is the "What" the right way to solve the problem? Does it fit the product vision?
*   **Impact Analysis:** Are the listed affected changes complete?

### 2. Specification Review (The "How")
The specification lives at `openspec/changes/*/spec.md`
*   **Ambiguity:** Are requirements precise? Flag vague terms.
*   **Scenarios:** Are "Given/When/Then" scenarios defined for all key behaviors, including edge cases?
*   **Testability:** Is every requirement verifiable?
*   **Architecture:** Does the spec respect existing patterns (Gates, Runners, etc)?

### 3. Task Plan Review (The "Plan")
The task plan lives at `openspec/changes/*/tasks.md`
*   **Pre-factoring Section:** Does `tasks.md` begin with a `## 0. Pre-factoring` section? It MUST always be present — either listing CodeScene hotspot refactorings or stating "No hotspots modified."
*   **Pre-factoring Design:** If pre-factoring tasks are listed, does `design.md` exist and contain a `## Pre-factoring` section documenting the hotspot scores, code smells, and refactoring strategy?
*   **Completeness:** Do the tasks map 1:1 to the Spec requirements?
*   **Actionability:** Are the tasks broken down enough to be safe and clear?
*   **Validation:** Do the validation steps cover the critical user paths?
*   **Test Coverage:** Is there a sufficient breadth and clarity of test cases?
*   **Documentation updates:** Is there a task for updating documentation if any of the following apply?
    *   The change adds or modifies CLI commands/options (`docs/user-guide.md#commands`)
    *   The change adds or modifies config fields (`docs/config-reference.md`)
    *   The change affects workflows, entry points, or gate behavior (`docs/user-guide.md`)

### 4. OpenSpec Standards Compliance
Reference: `openspec/AGENTS.md`
*   **Format:** Do spec deltas use correct headers (`## ADDED|MODIFIED|REMOVED Requirements`, `#### Scenario:`)?
*   **Wording:** Do requirements use SHALL/MUST for normative statements?
*   **Structure:** Is the change directory properly scaffolded (`proposal.md`, `tasks.md`, `specs/` deltas)?
