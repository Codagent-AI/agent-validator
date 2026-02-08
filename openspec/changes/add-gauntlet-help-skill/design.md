# Design: gauntlet-help skill structure

## Context
`/gauntlet-help` is a diagnostic skill for answering "what happened" and "why" questions about gauntlet behavior. It must work in installed environments where source code may be unavailable.

The design therefore emphasizes:
- source-independent investigation
- prompt-only guidance
- progressive loading via references
- evidence-first diagnosis

## Goals
- Provide reliable triage for common gauntlet support questions
- Diagnose from runtime artifacts and command output, not source files
- Keep the skill maintainable by splitting guidance into focused reference files
- Auto-run only the commands needed to disambiguate the issue

## Non-Goals
- No automatic remediation/fixing logic
- No executable helper scripts in this skill
- No requirement to enumerate separate spec scenarios per individual status/check

## Skill File Layout
The skill bundle uses a router + references structure:

```text
gauntlet-help/
  SKILL.md
  references/
    diagnostic-workflow.md
    evidence-sources.md
    status-playbooks.md
    question-playbooks.md
    output-contract.md
```

### File Responsibilities
- `SKILL.md`: route by user question type/status, set investigation guardrails, and load only relevant reference files
- `references/diagnostic-workflow.md`: high-level investigation sequence and decision points
- `references/evidence-sources.md`: where to collect signals (`config.yml`, `log_dir`, `.debug.log`, `.execution_state`, gate logs/review JSON, CLI commands)
- `references/status-playbooks.md`: concise meaning + likely causes + evidence checks for all gauntlet status outcomes
- `references/question-playbooks.md`: targeted playbooks for high-frequency user asks (for example: "no changes", "configured checks", "what happened last run")
- `references/output-contract.md`: fixed response shape (`Diagnosis`, `Evidence`, `Confidence`, `Next steps`)

## Per-File Content Guidance
### `SKILL.md`
- Define invocation scope as diagnosis-only and prompt-only.
- Route investigations by question type/status and load only needed references.
- Require `log_dir` resolution from `.gauntlet/config.yml` before any log reads.

### `references/diagnostic-workflow.md`
- Define ordered triage steps from evidence collection to conclusion.
- Clarify when to rely on passive artifacts versus when to run commands.
- Include fallback behavior when evidence is incomplete.

### `references/evidence-sources.md`
- List required files and paths (`config.yml`, resolved `log_dir`, `.debug.log`, `.execution_state`, gate/review outputs).
- Describe what each evidence source can and cannot confirm.
- Define when `agent-gauntlet list`, `agent-gauntlet health`, and `agent-gauntlet detect` should be run.

### `references/status-playbooks.md`
- Cover every supported gauntlet stop-hook status in one compact playbook.
- For each status, include meaning, likely causes, and verification signals.
- Prefer actionable checks over implementation-level internals.

### `references/question-playbooks.md`
- Provide focused guides for high-frequency user questions.
- Map each question to minimum evidence needed and likely next commands.
- Keep playbooks concise and bias toward resolving ambiguity quickly.

### `references/output-contract.md`
- Define required response sections: `Diagnosis`, `Evidence`, `Confidence`, `Next steps`.
- Define confidence levels (`high`/`medium`/`low`) and when to downgrade confidence.
- Require explicit separation of confirmed facts versus inference.

## Investigation Strategy
1. Read `.gauntlet/config.yml` and resolve `log_dir`.
2. Start with passive evidence from logs/state (`.debug.log`, `.execution_state`, latest gate/review logs).
3. Run `agent-gauntlet list`, `agent-gauntlet health`, or `agent-gauntlet detect` only when logs/config are insufficient for a confident diagnosis.
4. Return an evidence-backed explanation, clearly distinguishing confirmed findings from inference.

## Installation Model
- Claude installs SHALL include the full `gauntlet-help` skill bundle (`SKILL.md` + `references/`).
- Non-Claude installs remain command-based and are unchanged by this change.

## Compatibility Notes
- The skill must not assume `gauntlet_logs`; it uses configured `log_dir`.
- The skill must include `.execution_state` in diagnostics because it carries important run context (timestamps, branch/commit refs, and optional adapter health state).

## Decisions
- Use a prompt-only skill instead of scripts to keep behavior transparent and easy to iterate in markdown.
- Use `SKILL.md` as a router plus focused `references/*.md` files to keep context small and load only relevant guidance.
- Prefer passive evidence first (config/logs/state) and invoke `list`, `health`, and `detect` only when needed to disambiguate diagnosis.

## Alternatives Considered
- Single-file skill with all guidance in `SKILL.md`: rejected because it increases context size and reduces maintainability.
- New `agent-gauntlet help` subcommand for diagnosis: rejected for this change because the goal is an in-agent workflow using existing skill infrastructure.
- Bundled parser scripts in `gauntlet-help`: rejected for v1 because the requested scope is prompt-only diagnostics.

## Risks / Trade-offs
- Missing or incomplete evidence files (`.debug.log`, `.execution_state`, or gate logs) can reduce diagnostic confidence.
  - Mitigation: require explicit confidence labeling and next-step evidence requests.
- Misconfigured `log_dir` can lead to false "no data" conclusions.
  - Mitigation: require reading `log_dir` from `.gauntlet/config.yml` before log inspection.
- CLI availability issues can limit command-based diagnostics.
  - Mitigation: treat command failures as evidence and fall back to available artifacts.
