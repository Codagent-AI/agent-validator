# Redesign Init Command

## Summary

Transform `agent-gauntlet init` from a non-interactive scaffolding command into a guided, phased setup experience. The redesign introduces interactive CLI selection (development vs review CLIs), checksum-based idempotent file updates for re-runnability, and context-aware post-init instructions.

## Motivation

The current init command auto-installs for all detected CLIs without user input, conflates development and review tool selection, exits early when `.gauntlet/` exists (preventing updates), and uses simple file-existence checks that can't detect stale content. This redesign addresses all four gaps.

## Alternatives Considered

1. **Non-interactive init with CLI flags** — e.g. `init --dev claude,codex --review claude`. Simpler to implement but poor discoverability; new users wouldn't know the flag names or valid CLI values. The interactive approach guides users through choices they don't yet understand.

2. **Single CLI selection prompt** — one multi-select for all CLIs, using every selected CLI for both development and reviews. Simpler UX, but conflates two distinct roles: dev CLIs need hooks while review CLIs set `default_preference`. Users who develop in Claude but review with Codex couldn't express that preference.

3. **File-modification-time comparison instead of checksums** — detect changes by comparing mtime of installed files vs source. Fragile: git clone, branch switches, and CI all reset mtimes. Content-based checksums are deterministic regardless of filesystem metadata.

The phased interactive approach was chosen because it surfaces the dev/review distinction clearly, scales to future CLIs without flag proliferation, and uses checksums for reliable idempotency.

## Scope

This change modifies two specs across three spec deltas:

| Spec | Delta | Changes |
|------|-------|---------|
| `init-config` | `init-interactive-setup` | Interactive CLI selection (dev vs review), `num_reviews` prompting, `--yes` defaults, Phase 4 skip logic |
| `init-hook-install` | `init-checksum-updates` | Checksum-based update logic for skills and hooks, dev CLI scoping for hook installation |
| `init-config` | `init-phase-instructions` | Phase 6 context-aware post-init instructions (native vs non-native CLIs) |

Note: `init-config` has two deltas because interactive setup and post-init instructions are independent concerns that happen to target the same spec.

## Key Decisions

- **Interactive prompting library**: The project has no prompting dependency today. Implementation will need to add one (e.g., `@inquirer/prompts` or `@clack/prompts`). This is an implementation detail not captured in specs.
- **Checksum scope for skills**: Computed over all files in the skill directory (SKILL.md + references/), not just SKILL.md alone.
- **Checksum scope for hooks**: Computed over gauntlet-specific hook entries only, not the entire settings file.
- **`.gauntlet/` directory handling**: When it already exists, Phase 4 skips entirely (no modifications). Phase 5 always runs for external files.
- **`num_reviews` auto-set**: When exactly 1 review CLI is selected, `num_reviews` is set to 1 without prompting. When multiple are selected, user is prompted.

## Sequencing

1. `init-interactive-setup` — must land first (changes CLI selection flow, config generation, and `--yes` defaults)
2. `init-checksum-updates` — depends on interactive setup (checksum prompts reference the `--yes` flag behavior)
3. `init-phase-instructions` — can land independently but logically follows the other two
