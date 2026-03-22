---
name: validator-skip
description: Advances the validator execution state baseline without running checks. Use when asked to "skip validator", "advance validator baseline", or "mark current tree as validated without running checks".
disable-model-invocation: true
allowed-tools: Bash
---

# /validator-skip
Advance the execution state baseline to the current working tree without running any gates. The next `agent-validate run` will only diff against changes made after this skip.

## Step 1: Run the skip command

```bash
agent-validate skip 2>&1
```

Report the command output to the user.
