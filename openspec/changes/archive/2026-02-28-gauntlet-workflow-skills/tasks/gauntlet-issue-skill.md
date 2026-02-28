# Task: gauntlet-issue skill + gauntlet-help bug-filing update

## Goal

Create `skills/gauntlet-issue/SKILL.md` — a skill that collects diagnostic evidence and files a structured GitHub issue for suspected gauntlet bugs. Then update `skills/gauntlet-help/SKILL.md` to automatically invoke `gauntlet-issue` on high-confidence bug diagnoses and prompt the user on medium-confidence ones.

## Background

**Skill conventions.** All skills live in `skills/<name>/SKILL.md`. Read `skills/gauntlet-help/SKILL.md` before writing either file — it shows the evidence collection pattern (resolving `log_dir` from `.gauntlet/config.yml`, reading `.debug.log`, `.execution_state`) that `gauntlet-issue` should follow. It also shows the `allowed-tools` frontmatter field.

**gauntlet-issue design:**

- `$ARGUMENTS`: if non-empty, treat as the bug description; if empty, ask the user before proceeding.
- Evidence to collect (read `.gauntlet/config.yml` first to resolve `log_dir`, default `gauntlet_logs`):
  - Last 50 lines of `<log_dir>/.debug.log`
  - Full contents of `<log_dir>/.execution_state`
  - `.gauntlet/config.yml`
  - Note which files are absent if any don't exist — do not fail.
- Draft issue with sections: **Problem**, **Steps to Reproduce**, **Expected vs Actual**, **Evidence** (relevant excerpts from debug log and execution state).
- Show the full draft to the user and ask for confirmation before filing.
- File with: `gh issue create --repo pacaplan/agent-gauntlet --title "..." --body "..."`. Report the URL.
- If the user declines, exit without creating an issue.
- `disable-model-invocation: false`. `allowed-tools: Bash, Read, Glob`.

**Example issue for reference** — look at the issue structure at https://github.com/pacaplan/agent-gauntlet/issues/89 to understand the tone and detail level expected. Do NOT fetch this URL in the skill — it's reference for the implementer only.

**gauntlet-help modification:**

`skills/gauntlet-help/SKILL.md` ends with a `### Next Steps` section. Append a new `## Bug Filing` section after it with the following routing logic:

- **High confidence + bug indicated** → automatically invoke `gauntlet-issue`, passing the diagnosis summary as the bug description. No user prompt needed.
- **High confidence + not a bug** (config/user error/expected behavior) → do nothing.
- **Medium confidence + possible bug** → ask: "This may be a gauntlet bug. Want me to file a GitHub issue?" If yes, invoke `gauntlet-issue`. If no, exit.
- **Low confidence** → do nothing.

The existing `gauntlet-help` skill ends exactly at line 90 (`### Next Steps` content). Append cleanly after that — do not modify any existing content.

## Spec

### Requirement: Diagnostic Evidence Collection

The `gauntlet-issue` skill SHALL collect runtime evidence from the gauntlet log directory before drafting a bug report.

#### Scenario: Evidence collected from log directory

- **WHEN** the skill is invoked
- **THEN** it SHALL read `.gauntlet/config.yml` to resolve the `log_dir`
- **AND** SHALL collect the last 50 lines of `<log_dir>/.debug.log`
- **AND** SHALL collect the full contents of `<log_dir>/.execution_state`
- **AND** SHALL collect `.gauntlet/config.yml`

#### Scenario: Evidence files missing

- **WHEN** one or more evidence files do not exist
- **THEN** the skill SHALL note which files are absent
- **AND** SHALL proceed with drafting the issue using available evidence

### Requirement: Bug Description Input

The `gauntlet-issue` skill SHALL use ARGUMENTS as the bug description if provided, and SHALL ask the user for one if not.

#### Scenario: Description provided in ARGUMENTS

- **WHEN** ARGUMENTS contains a non-empty description of the bug
- **THEN** the skill SHALL use it as the basis for the issue without asking for additional input

#### Scenario: No description in ARGUMENTS

- **WHEN** ARGUMENTS is empty
- **THEN** the skill SHALL ask the user to describe the bug before proceeding

### Requirement: Issue Preview and Confirmation

The `gauntlet-issue` skill SHALL show the user a full preview of the issue before filing and SHALL require explicit confirmation.

#### Scenario: User reviews and confirms

- **WHEN** the skill presents the drafted issue (title and body)
- **AND** the user confirms
- **THEN** the skill SHALL file the issue via `gh issue create --repo pacaplan/agent-gauntlet`
- **AND** SHALL report the created issue URL

#### Scenario: User declines

- **WHEN** the skill presents the drafted issue
- **AND** the user declines to file
- **THEN** the skill SHALL exit without creating an issue

### Requirement: Issue Structure

Filed issues SHALL follow a consistent structure derived from the collected evidence and bug description.

#### Scenario: Issue body sections

- **WHEN** the skill drafts a GitHub issue
- **THEN** the issue body SHALL contain: Problem, Steps to Reproduce, Expected vs Actual, and Evidence sections
- **AND** the Evidence section SHALL include relevant excerpts from the debug log and execution state

### Requirement: Automatic Bug Filing on High-Confidence Diagnosis

After completing its diagnosis, the `gauntlet-help` skill SHALL automatically invoke `gauntlet-issue` when the confidence level of the diagnosis is High and the evidence points to a gauntlet bug.

#### Scenario: High-confidence bug diagnosis

- **WHEN** the skill completes a diagnosis with confidence level High
- **AND** the diagnosis indicates a likely bug in agent-gauntlet (not a configuration or user error)
- **THEN** the skill SHALL automatically invoke `gauntlet-issue`
- **AND** SHALL pass the diagnosis summary as the bug description

#### Scenario: High-confidence non-bug diagnosis

- **WHEN** the skill completes a diagnosis with confidence level High
- **AND** the diagnosis indicates a configuration issue, user error, or expected behavior
- **THEN** the skill SHALL NOT invoke `gauntlet-issue`

### Requirement: User-Prompted Bug Filing on Medium-Confidence Diagnosis

When the diagnosis confidence is Medium and the evidence suggests a possible bug, the `gauntlet-help` skill SHALL ask the user whether to file a GitHub issue.

#### Scenario: Medium-confidence possible bug

- **WHEN** the skill completes a diagnosis with confidence level Medium
- **AND** the evidence suggests a possible gauntlet bug
- **THEN** the skill SHALL ask the user: "This may be a gauntlet bug. Want me to file a GitHub issue?"
- **AND** if the user confirms, SHALL invoke `gauntlet-issue` with the diagnosis as the bug description
- **AND** if the user declines, SHALL exit without filing

#### Scenario: Low-confidence diagnosis

- **WHEN** the skill completes a diagnosis with confidence level Low
- **THEN** the skill SHALL NOT prompt the user to file an issue
- **AND** SHALL NOT invoke `gauntlet-issue`

## Done When

All spec scenarios pass review. `skills/gauntlet-issue/SKILL.md` exists and is invocable as `/gauntlet-issue`. `skills/gauntlet-help/SKILL.md` has the Bug Filing section appended with no modifications to existing content.
