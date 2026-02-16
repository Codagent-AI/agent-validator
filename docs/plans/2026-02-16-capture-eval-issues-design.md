# Capture Eval Issues — Design

## Problem

Agent Gauntlet has an eval framework (`evals/`) that benchmarks review adapters against a hand-crafted set of ground truth issues. Currently, adding new test cases to this framework is entirely manual. When gauntlet runs catch real issues during day-to-day use, there's no mechanism to capture those findings for later inclusion in the eval suite.

## Goal

Automatically capture noteworthy review violations during gauntlet runs into a version-controlled inventory file (`evals/inventory.yml`). This inventory serves as a staging area — you review it later and promote entries into the eval framework's ground truth fixtures.

## Design

### Skill Structure

```
.claude/skills/capture-eval-issues/
├── SKILL.md                    # Thin wrapper: passes JSON paths to subagent
├── judge-prompt.md             # Subagent instructions (judging + YAML generation)
└── scripts/
    └── append-inventory.ts     # Deterministic script: appends YAML to evals/inventory.yml
```

### Flow

1. gauntlet-run detects review failures and knows the JSON file paths (e.g., `gauntlet_logs/review_src_claude@1.0.json`)
2. gauntlet-run invokes the capture skill, passing those JSON file paths
3. SKILL.md tells Claude to spawn a **sonnet** subagent via `Task` with the judge-prompt content and the JSON file paths
4. The subagent does all the work: reads the JSON files, judges each violation against the capture criteria, and produces YAML entries for noteworthy ones
5. The subagent calls `bun run <skill-dir>/scripts/append-inventory.ts` passing the YAML on stdin, and the script appends the entries to `evals/inventory.yml`

The main agent's only job is spawning the subagent. The subagent reads, judges, and invokes the script. The script does the file write.

### Judging Criteria

A violation is capture-worthy only if it meets **both** criteria:

1. **Critical or high priority** — the reviewer flagged it as `critical` or `high`
2. **Non-obvious catch** — not something a linter or formatter would flag:
   - Logic errors, race conditions, security flaws, architectural problems
   - Fix requires understanding context beyond the immediate line
   - A junior developer would likely miss it

Both must be true. A critical linter finding is skipped. A subtle but low-priority style issue is skipped.

### Captured Entry Schema

Each captured entry uses the ground truth schema (minus `requires_tool_use`):

```yaml
- id: missing-null-check          # kebab-case slug
  file: src/api/handler.ts        # file path
  line_range: [42, 44]            # [start, end]
  description: >                  # what the bug is and why it's bad
    The return value of findUser() is accessed without a null check...
  category: bug                   # bug | security | performance
  difficulty: medium              # easy | medium | hard
  priority: high                  # critical | high | medium | low
  source: "2026-02-16 agent-gauntlet"  # date and project for traceability
```

### Append Script

`scripts/append-inventory.ts` is a deterministic bun script that:

- Accepts YAML entries on stdin
- Reads `evals/inventory.yml` (creates it with `issues: []` if missing)
- Appends the new entries under the `issues` key
- Writes the file back

No judging logic, no LLM calls — just a YAML append.

### Deduplication

None. Entries are always appended. Manual deduplication happens when reviewing the inventory before promoting entries to ground truth.

### gauntlet-run Integration

After step 6 (updating review decisions) and before step 7 (re-run), add:

> **6b. Capture noteworthy violations:** If any review violations were found, invoke `/capture-eval-issues` with the JSON file paths that contain failures.

Capture happens once per gauntlet cycle, before the retry.
