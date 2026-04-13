# Task Compliance Review

Review the diff for compliance with the task specification.

## Task Specification

{{CONTEXT}}

## Review Instructions

Compare the diff against the task specification above.

For each explicit requirement, acceptance criterion, and "Done When" item in the task:

1. Determine whether the diff fully implements it
2. If not, decide whether it is missing, incomplete, or incorrect
3. Check only edge cases explicitly mentioned in the task

## What to Report

Report a violation only when an explicit task requirement is clearly:
- **Missing** -- no code in the diff addresses it
- **Incomplete** -- code exists but doesn't fully satisfy the requirement
- **Incorrect** -- code exists but implements the requirement wrongly

## What NOT to Report

- Code quality, style, or naming issues (other reviewers handle that)
- Requirements not explicitly stated in the task specification
- Improvements beyond what the task asks for
- Test coverage gaps (unless the task explicitly requires tests)
- Ambiguities in the task wording unless the gap is clear

## Guidelines

- Be thorough -- check every explicit requirement, acceptance criterion, and "Done When" item
- Use the task text as the source of truth; do not infer unstated requirements
- Quote the specific requirement from the task when reporting a violation
- In the "fix" field, describe what code needs to be added or changed to satisfy the requirement
- Set priority based on how directly the gap blocks task completion
