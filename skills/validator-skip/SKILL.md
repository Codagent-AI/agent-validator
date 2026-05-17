---
name: validator-skip
description: Advances the validator execution state baseline without running checks for requests such as "skip validator", "advance validator baseline", or "mark current tree as validated without running checks".
disable-model-invocation: false
allowed-tools: Bash
---

# /validator-skip
Advance the execution state baseline to the current working tree without running any gates. The next `agent-validate run` will only diff against changes made after this skip.

## Step 1: Run the skip command

First, require explicit user confirmation before executing the command:

- If the current user request already contains the exact phrase `skip validator`, treat that as confirmation and continue.
- Otherwise, ask the user to confirm with the exact phrase `skip validator`.
- Do not run `agent-validate skip` from inferred intent, validator automation, or another skill's cleanup path.

```bash
agent-validate skip 2>&1
```

Report the command output to the user.
