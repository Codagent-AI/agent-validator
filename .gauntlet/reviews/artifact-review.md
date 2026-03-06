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

#### 4a. Task index (tasks.md)
*   Does tasks.md follow the template structure (checkbox list with `tasks/<slug>.md` paths)?
*   Every spec requirement traces to at least one task?
*   Every task traces back to a spec requirement?
*   Ordering and grouping makes sense for implementation?

#### 4b. Task file structure
Read every task file in `tasks/`. Each one must follow the plan-tasks skill format:

**Required sections (multi-task changes):**
*   `## Goal` — 1–3 sentences on what the task accomplishes and why. Flag if missing or using a different heading (e.g., "Summary").
*   `## Background` — context the implementer needs: relevant design decisions, key files, constraints, conventions. Flag if missing.
*   `## Spec` — verbatim spec scenarios copied from the spec files, structured as `### Requirement:` / `#### Scenario:` with WHEN/THEN conditions. Flag if scenarios are summarized, paraphrased, or replaced with counts (e.g., "all 5 scenarios").
*   `## Done When` — concrete completion criterion. Flag if missing.

**Required sections (single-task changes):**
*   `## Goal`, `## Background` (with explicit file paths to read), `## Done When`. Spec section is optional if Background references spec files by path.

**Content rules — flag violations of any of these:**
*   **No code snippets as implementation instructions.** Task files describe *what* to build and the constraints that matter, not *how* to write each line. Code blocks showing function implementations, class definitions, or method bodies are violations. (Brief type signatures or interface shapes to clarify a constraint are acceptable.)
*   **No arbitrary decision numbering.** References like "(D1)", "(D4)", "Decision 3" are meaningless to the implementer — state the decision itself in prose.
*   **No cross-task references.** Phrases like "built in Task 2" or "required by Task 5" violate self-containment. Each task must be understandable in isolation.
*   **No unresolved placeholders.** `<path to file>`, `<your-service>`, or similar template placeholders must be resolved to actual values.
*   **Exact file paths.** Key files must use real paths from the codebase, not placeholders.
*   **No extraneous sections.** Sections like "Files to modify", "Implementation details", or "Tests" are not part of the format. Implementation guidance belongs in Background; test expectations are captured by the Spec scenarios and Done When.

### 5. Cross-Artifact Coherence
*   Each capability in proposal has a corresponding spec file?
*   Design decisions are reflected in spec requirements?
*   No contradictions between artifacts?
*   The story is consistent from proposal through tasks?
