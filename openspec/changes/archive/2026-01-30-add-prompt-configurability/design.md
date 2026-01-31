## Context
Agent Gauntlet reviews are configured via `.gauntlet/reviews/*.md` files (markdown with YAML frontmatter). Checks use `.gauntlet/checks/*.yml` with an optional `fix_instructions` file path. Users want to:
1. Reference external prompt files for reuse across projects
2. Delegate reviews/fixes to named CLI skills
3. Use YAML-only review configs without markdown bodies

## Goals / Non-Goals
- Goals: Configurable prompt sources for reviews; configurable fix strategies for checks; backward compatibility with deprecated field alias
- Non-Goals: Implementing skill execution infrastructure (fields are plumbed through for consumers); changing how adapters execute prompts

## Decisions
- Decision: Support both `.md` and `.yml` in reviews directory. `.yml` files require exactly one of `prompt_file` or `skill_name`. `.md` files can optionally override their body via frontmatter `prompt_file` or `skill_name`.
- Alternatives considered: YAML-only (breaks existing configs), frontmatter-only (awkward for skill-only reviews with no body)

- Decision: Allow absolute paths for `prompt_file` and `fix_instructions_file` with a logged warning.
- Alternatives considered: Restrict to `.gauntlet/` (too limiting for cross-project sharing), restrict to project root (still limiting for shared prompt libraries)

- Decision: Rename `fix_instructions` to `fix_instructions_file` with deprecated alias support.
- Alternatives considered: Keep old name (confusing alongside `fix_with_skill`), hard break (disrupts existing configs)

## Risks / Trade-offs
- Absolute paths enable data exfiltration if a malicious PR modifies `.gauntlet/` config to point at sensitive files (e.g., `~/.ssh/id_rsa`). Mitigation: log warning at load time, document that `.gauntlet/` changes should be reviewed carefully in PRs.
- Duplicate names across `.md` and `.yml` in reviews directory. Mitigation: detect and throw error at load time.

## Open Questions
- None remaining (all clarified with user).
