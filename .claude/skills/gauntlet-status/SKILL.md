---
name: gauntlet-status
description: Show a summary of the most recent gauntlet session
disable-model-invocation: true
allowed-tools: Bash, Read
---

# /gauntlet-status
Show a structured summary of the most recent gauntlet session.

Run the bundled status script and present the output:

```bash
bun .gauntlet/skills/gauntlet/status/scripts/status.ts
```

If the script fails, read its error output and report the issue. Do not attempt to parse the log files manually.
