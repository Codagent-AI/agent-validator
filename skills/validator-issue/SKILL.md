---
name: validator-issue
description: Files structured GitHub bug reports for agent-validator when users ask to file, report, or open an issue for a suspected defect
disable-model-invocation: false
allowed-tools: Bash, Read, Glob
---

# /validator-issue

Collect runtime evidence, draft a structured GitHub issue for a suspected agent-validator bug, present a full preview, and file only after confirmation — unless invoked in auto-file mode.

## Step 1: Get the Bug Description and Mode

**Check for auto-file mode**: If `$ARGUMENTS` begins with `--auto-file `, set auto-file mode to **on** and strip the prefix to get the remaining text as the bug description. Skip the confirmation step (Step 4) when auto-file mode is on.

**Get the description**:
- If a non-empty description remains after stripping any `--auto-file` prefix, use it as the bug description and proceed to Step 2.
- If `$ARGUMENTS` is empty (or becomes empty after stripping), ask the user:

  > "Please describe the bug you encountered with agent-validator. What happened, what did you expect, and what were you trying to do?"

  Wait for their response before continuing.

## Step 2: Collect Evidence

Read `.validator/config.yml` first to resolve `log_dir` (default: `validator_logs` if the field is absent or the file doesn't exist).

Collect the following evidence. For each item, note if it is absent — do not fail if files are missing:

1. **Config file**: Read `.validator/config.yml` in full.
2. **Debug log (last 50 lines)**: Read the last 50 lines of `<log_dir>/.debug.log`.
   ```bash
   tail -n 50 <log_dir>/.debug.log
   ```
3. **Execution state**: Read the full contents of `<log_dir>/.execution_state`.

Record which files were found and which were absent.

## Step 3: Draft the Issue

Draft a GitHub issue with the following structure:

```
## Problem

<A clear, concise description of the bug. Based on the user's description.>

## Steps to Reproduce

<Step-by-step instructions to reproduce the issue. Infer from the description and evidence, or note "Not yet determined" if unclear.>

## Expected vs Actual

**Expected:** <What should have happened>

**Actual:** <What actually happened>

## Evidence

> **Before including evidence, redact sensitive values**: remove or replace tokens, API keys, email addresses, and absolute local paths that may appear in config, logs, or state. Replace them with `[REDACTED]` or a generic placeholder.

**Config (`.validator/config.yml`):**
<Paste only relevant, non-sensitive config values. Redact tokens, emails, and absolute paths. Note "File not found" if absent.>

**Debug log (last 50 lines of `<log_dir>/.debug.log`):**
<Paste minimal relevant excerpt with sensitive values redacted. Note "File not found" if absent.>

**Execution state (`<log_dir>/.execution_state`):**
<Paste only fields needed to diagnose the bug; redact sensitive values. Note "File not found" if absent.>

**Absent files:** <List any files that were not found, or "None">
```

Choose a concise, descriptive title: `Bug: <short summary of the problem>`.

## Step 4: Show Preview and Confirm

Present the full draft to the user — both title and body.

**If auto-file mode is on**: Inform the user that the issue will be filed automatically (show the title and body), then proceed directly to Step 5 without asking.

**Otherwise**, ask:

> "Here is the draft issue. Shall I file it? (yes/no)"

- If the user confirms: proceed to Step 5.
- If the user declines: exit without creating an issue. Inform the user that no issue was filed.

## Step 5: File the Issue

Write the issue body to a temporary file and pass it via `--body-file` to avoid shell interpolation issues with special characters in the body text:

```bash
ISSUE_TITLE=$(cat <<'TITLE_EOF'
Bug: <short summary>
TITLE_EOF
)
BODY_FILE=$(mktemp)
cat > "$BODY_FILE" << 'ISSUE_EOF'
<paste the full issue body here>
ISSUE_EOF
gh issue create --repo Codagent-AI/agent-validator --title "$ISSUE_TITLE" --body-file "$BODY_FILE"
rm -f "$BODY_FILE"
```

Report the created issue URL to the user.
