---
num_reviews: 1
parallel: true
run_in_ci: true
run_locally: true
---

# Code Review

Review the diff for quality issues:

- **Bugs**: Logic errors, null handling, edge cases, race conditions
- **Security**: Input validation, secrets exposure, injection risks
- **Maintainability**: Unclear code, missing error handling, duplication
- **Performance**: Unnecessary work, N+1 queries, missing optimizations

For each issue: cite file:line, explain the problem, suggest a fix.
