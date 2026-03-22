---
name: validator-merge
description: >-
  Merges a named branch into the current worktree and propagates the validated execution state from that branch's worktree, eliminating redundant re-validation. Activates for requests such as "merge with validator state", "merge and carry execution state", "reuse validated state after merge", or "merge branch without re-running validator".
disable-model-invocation: false
allowed-tools: Bash
---

# /validator-merge $ARGUMENTS

Merge a branch and copy its validated execution state so the current directory inherits the already-verified results.

## Step 1 - Run the merge script

```bash
bash skills/validator-merge/merge-state.sh "$ARGUMENTS"
```

Run this command using `Bash` and capture both stdout and the exit code.

## Step 2 - Report the result

- **If exit code is 0**: Report success. Include the script's output confirming the merge and state copy.
- **If exit code is non-zero**: Report the error. The script will have printed an error message — relay it clearly to the user. Do not proceed further.
