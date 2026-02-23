---
name: gauntlet-skip
description: Advance the gauntlet execution state baseline without running verification gates
disable-model-invocation: true
allowed-tools: Bash
---

# /gauntlet-skip
Advance the execution state baseline to the current working tree without running any gates. The next `agent-gauntlet run` will only diff against changes made after this skip.

## Step 1: Run the skip command

```bash
agent-gauntlet skip 2>&1
```

Report the command output to the user.
