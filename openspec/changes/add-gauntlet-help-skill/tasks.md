## 0. Pre-factoring

No hotspots modified.

## 1. Implementation

- [ ] 1.1 Add a new `gauntlet-help` skill bundle (`SKILL.md` + `references/*.md`) with prompt-only diagnostic guidance (no scripts)
- [ ] 1.2 Define and enforce the investigation flow: resolve `log_dir`, inspect logs/state first, then run `agent-gauntlet list|health|detect` only when needed
- [ ] 1.3 Include `.execution_state` as a required evidence source in the skill guidance
- [ ] 1.4 Include status playbook guidance covering all gauntlet stop-hook statuses without creating per-status implementation branches
- [ ] 1.5 Update init installation so Claude installs include the `gauntlet-help` bundle alongside existing gauntlet skills
- [ ] 1.6 Keep non-Claude installation behavior unchanged
- [ ] 1.7 Update skills documentation to include `/gauntlet-help` and its diagnostic scope

## 2. Tests

- [ ] 2.1 Test: init installs `.claude/skills/gauntlet-help/SKILL.md` for Claude
- [ ] 2.2 Test: init installs the `references/` files for `gauntlet-help` (not just `SKILL.md`)
- [ ] 2.3 Test: `gauntlet-help` bundle contains expected reference files from design (`diagnostic-workflow.md`, `evidence-sources.md`, `status-playbooks.md`, `question-playbooks.md`, `output-contract.md`)
- [ ] 2.4 Test: `gauntlet-help` routing guidance references `log_dir` resolution from `.gauntlet/config.yml`
- [ ] 2.5 Test: `gauntlet-help` evidence guidance references `.debug.log`, `.execution_state`, and gate/review logs under resolved `<log_dir>`
- [ ] 2.6 Test: non-Claude installs do not gain unexpected `gauntlet-help` flat command files

## 3. Validation

If there is a "Pre-factoring" section above, confirm those refactorings are complete before marking the task complete.
If there is a "Manual Verification" section above, complete all verification steps before marking the task complete.

There are no automated validation tasks that need to be explicitly run. When work is completed, a stop hook should execute the full gauntlet of verification tasks and give direction on what needs to be fixed.
