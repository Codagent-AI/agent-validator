---
num_reviews: 2
---

# Artifact Review

**Role:** You are the Lead Architect reviewing an OpenSpec change package before implementation begins.

**Objective:** Validate that all artifacts (proposal, design, specs, tasks) are complete, coherent, and ready for implementation.

**Important:** Do not review archived files — `openspec/changes/archive/*`.

**Required reading before reviewing:** Read these reference files first — they define the standards each artifact must meet. Apply them as your review criteria rather than relying only on the high-level checks below.

- **Artifact templates** (skip `design.md`): Read the HTML comments in `openspec/schemas/flokay/templates/proposal.md`, `openspec/schemas/flokay/templates/spec.md`, `openspec/schemas/flokay/templates/review.md`, and `openspec/schemas/flokay/templates/tasks.md`. Each template contains formatting rules, required sections, and constraints. Verify that the corresponding change artifacts follow all template instructions.
- **Plan-tasks skill**: Use the `flokay:plan-tasks` skill for the review. This is the authoritative reference for task granularity — splitting rules, merge test, anti-patterns, and examples. Use it to evaluate whether the task breakdown is at the right level.

**Evaluation Criteria:**

### 1. Proposal (The "Why")
The proposal lives at `openspec/changes/*/proposal.md`
*   Does the "Why" clearly justify the effort?
*   Are capabilities clearly scoped (new vs modified)?
*   Is impact analysis complete?
*   Are there obvious alternatives not considered?
*   Does it follow the structure and instructions in the proposal template?

### 2. Design (The "How")
The design lives at `openspec/changes/*/design.md`
*   Does it address everything the proposal promises?
*   Are technical decisions justified?
*   Does it respect existing architecture and patterns?

### 3. Specs (The Contract)
Specs live at `openspec/changes/*/specs/*/spec.md`
*   Requirements are testable and unambiguous?
*   Scenarios cover edge cases, not just the happy path?
*   Does each spec follow the structure and instructions in the spec template?

### 4. Tasks (The Plan)
Tasks live at `openspec/changes/*/tasks.md` or `openspec/changes/*/tasks/`
*   Every spec requirement traces to at least one task?
*   Every task traces back to a spec requirement?
*   Ordering and grouping makes sense for implementation?
*   **Task granularity:** Are tasks at the right level — not too big, not too small? Apply the splitting rules, merge test, anti-patterns, and size guidance from the plan-tasks skill. Flag tasks that look like "laying the groundwork," split too finely by layer, or bundle too much into one unit.
*   Does the tasks.md follow the structure in the tasks template?

### 5. Cross-Artifact Coherence
*   Each capability in proposal has a corresponding spec file?
*   Design decisions are reflected in spec requirements?
*   No contradictions between artifacts?
*   The story is consistent from proposal through tasks?
