## 0. Pre-factoring

No hotspots modified.

## 1. Implementation

- [ ] 1.1 Create `.claude/skills/gauntlet-help/SKILL.md` as the diagnostic router with prompt-only behavior (no scripts), log-dir-first flow, and reference-loading rules
- [ ] 1.2 Create `.claude/skills/gauntlet-help/references/diagnostic-workflow.md` with the stepwise investigation sequence and command-vs-log decision points
- [ ] 1.3 Create `.claude/skills/gauntlet-help/references/evidence-sources.md` covering required evidence locations (`config.yml`, resolved `log_dir`, `.debug.log`, `.execution_state`, gate/review logs, and diagnostic commands)
- [ ] 1.4 Create `.claude/skills/gauntlet-help/references/status-playbooks.md` with concise diagnosis guidance for all gauntlet stop-hook statuses
- [ ] 1.5 Create `.claude/skills/gauntlet-help/references/question-playbooks.md` for common asks (for example: "no changes", "configured checks", "what happened last run")
- [ ] 1.6 Create `.claude/skills/gauntlet-help/references/output-contract.md` defining required response structure (`Diagnosis`, `Evidence`, `Confidence`, `Next steps`)
- [ ] 1.7 Update init installation so Claude installs include the full `gauntlet-help` bundle (`SKILL.md` + `references/`) alongside existing gauntlet skills
- [ ] 1.8 Keep non-Claude installation behavior unchanged
- [ ] 1.9 Update skills documentation to include `/gauntlet-help` and its diagnostic scope

## 2. Tests

- [ ] 2.1 Test: init installs `.claude/skills/gauntlet-help/SKILL.md` for Claude
- [ ] 2.2 Test: init installs the `references/` files for `gauntlet-help` (not just `SKILL.md`)
- [ ] 2.3 Test: non-Claude installs do not gain unexpected `gauntlet-help` flat command files

## 3. Validation

If there is a "Pre-factoring" section above, confirm those refactorings are complete before marking the task complete.
If there is a "Manual Verification" section above, complete all verification steps before marking the task complete.

There are no automated validation tasks that need to be explicitly run. When work is completed, a stop hook should execute the full gauntlet of verification tasks and give direction on what needs to be fixed.
