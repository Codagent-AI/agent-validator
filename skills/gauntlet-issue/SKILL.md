---
name: gauntlet-issue
description: Files structured GitHub bug reports for agent-gauntlet when users ask to file, report, or open an issue for a suspected defect
disable-model-invocation: false
allowed-tools: Bash, Read, Glob
---

# /gauntlet-issue

Collect runtime evidence, draft a structured GitHub issue for a suspected agent-gauntlet bug, present a full preview, and file only after confirmation — unless invoked in auto-file mode.

## Step 1: Get the Bug Description and Mode

**Check for auto-file mode**: If `$ARGUMENTS` begins with `--auto-file `, set auto-file mode to **on** and strip the prefix to get the remaining text as the bug description. Skip the confirmation step (Step 4) when auto-file mode is on.

**Get the description**:
- If a non-empty description remains after stripping any `--auto-file` prefix, use it as the bug description and proceed to Step 2.
- If `$ARGUMENTS` is empty (or becomes empty after stripping), ask the user:

  > "Please describe the bug you encountered with agent-gauntlet. What happened, what did you expect, and what were you trying to do?"

  Wait for their response before continuing.

## Step 2: Collect Evidence

Read `.gauntlet/config.yml` first to resolve `log_dir` (default: `gauntlet_logs` if the field is absent or the file doesn't exist).

Collect the following evidence. For each item, note if it is absent — do not fail if files are missing:

1. **Config file**: Read `.gauntlet/config.yml` in full.
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

**Config (`.gauntlet/config.yml`):**
<Paste relevant config values, or note "File not found">

**Debug log (last 50 lines of `<log_dir>/.debug.log`):**
<Paste log excerpt, or note "File not found">

**Execution state (`<log_dir>/.execution_state`):**
<Paste full contents, or note "File not found">

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
gh issue create --repo pacaplan/agent-gauntlet --title "$ISSUE_TITLE" --body-file "$BODY_FILE"
rm -f "$BODY_FILE"
```

Report the created issue URL to the user.
