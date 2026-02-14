---
name: OpenSpec: Proposal
description: Scaffold a new OpenSpec change and validate strictly.
category: OpenSpec
tags: [openspec, change]
---
<!-- OPENSPEC:START -->
**Guardrails**
- Favor straightforward, minimal implementations first and add complexity only when it is requested or clearly required.
- Keep changes tightly scoped to the requested outcome.
- Refer to `openspec/AGENTS.md` (located inside the `openspec/` directory—run `ls openspec` or `openspec update` if you don't see it) if you need additional OpenSpec conventions or clarifications.
- Identify any vague or ambiguous details and ask the necessary follow-up questions before editing files.
- Do not write any code during the proposal stage. Only create proposal documents (proposal.md and spec deltas). Implementation happens after approval.

**Prerequisites**
- A superpowers brainstorming design doc must exist at `docs/plans/YYYY-MM-DD-<topic>-design.md`. This is the input to the spec process.

**Steps**
1. Review `openspec/project.md`, run `openspec list` and `openspec list --specs`, and inspect related code or docs (e.g., via `rg`/`ls`) to ground the proposal in current behaviour; note any gaps that require clarification.
2. Choose a unique verb-led `change-id`, create the change directory, and move the design doc in: `mkdir -p openspec/changes/<id>/specs/ && mv docs/plans/YYYY-MM-DD-<topic>-design.md openspec/changes/<id>/design.md`
3. Read `design.md` and use it as the basis for writing `proposal.md` and spec deltas.
4. Map the change into concrete capabilities or requirements, breaking multi-scope efforts into distinct spec deltas with clear relationships and sequencing.
5. Draft spec deltas in `changes/<id>/specs/<capability>/spec.md` (one folder per capability) using `## ADDED|MODIFIED|REMOVED Requirements` with at least one `#### Scenario:` per requirement and cross-reference related capabilities when relevant.
6. Validate with `openspec validate <id> --strict --no-interactive` and resolve every issue before sharing the proposal.
7. After validation passes, automatically run the `gauntlet-run` skill to trigger the spec reviewer. Fix any issues it raises.

**Reference**
- Use `openspec show <id> --json --deltas-only` or `openspec show <spec> --type spec` to inspect details when validation fails.
- Search existing requirements with `rg -n "Requirement:|Scenario:" openspec/specs` before writing new ones.
- Explore the codebase with `rg <keyword>`, `ls`, or direct file reads so proposals align with current implementation realities.
<!-- OPENSPEC:END -->
