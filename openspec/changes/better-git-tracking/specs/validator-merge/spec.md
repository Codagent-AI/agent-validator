## REMOVED Requirements

### Requirement: Branch Merge with Execution State Propagation
**Reason**: The shared trust ledger makes trust visible across all worktrees automatically. The `validator-merge` skill is vestigial — users merge with `git merge` normally and trust propagates on the next validator invocation via startup reconciliation. The skill also had a bug where copied state retained the source branch name, triggering branch-mismatch auto-clean.
**Migration**: Use `git merge` followed by any validator command (`agent-validator run`, `check`, or `review`). Reconciliation handles trust evaluation automatically.

### Requirement: Script-Driven Worktree Discovery and State Copy
**Reason**: Worktree discovery for state-file copying is no longer needed. The shared ledger in `git-common-dir` makes trust visible across all worktrees without copying files.
**Migration**: Same as above — `git merge` followed by any validator command.
