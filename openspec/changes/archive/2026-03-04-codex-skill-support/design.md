## Context

The `init` command currently installs skills to a single hardcoded path (`.claude/skills/`) regardless of which CLIs the user selected. The `installSkillsWithChecksums()` function handles all skill installation, and `installExternalFiles()` orchestrates skills + hooks. The `CodexAdapter` already exists but returns `null` for `getProjectSkillDir()`. Codex uses `.agents/skills/` with the same `SKILL.md` format (name + description frontmatter), so no content transformation is needed.

When multiple skills change across a version bump, the user faces up to 9 individual y/n prompts with no batch shortcut.

## Goals / Non-Goals

**Goals:**
- Install skills to `.agents/skills/` when codex is selected as a dev CLI
- Reuse existing checksum and overwrite logic for the Codex directory
- Show Codex-native skill paths in post-init instructions
- Add "update all" option to batch-accept remaining skill updates
- Keep `.claude/skills/` installation unchanged (always installed)

**Non-Goals:**
- Transforming skill content between formats (not needed — formats are compatible)
- Supporting `getUserSkillDir()` for Codex (user-level skill dir is out of scope)
- Adding hook support for Codex (separate concern)
- Supporting other CLI-specific skill directories (e.g., Gemini) — can be added later following this pattern

## Decisions

### D1: Parameterize `installSkillsWithChecksums` to accept a target directory

Currently the function hardcodes `.claude/skills/`. Rather than duplicating it, add a `targetBaseDir` parameter. Call it once for `.claude/skills/` (always), and once for `.agents/skills/` (when codex is a selected dev CLI).

```
installSkillsWithChecksums(projectRoot, skipPrompts)
→ installSkillsWithChecksums(projectRoot, targetBaseDir, skipPrompts, updateAllState)
```

### D2: Pass dev adapters into `installExternalFiles` for conditional skill installation

`installExternalFiles` already receives `devAdapters`. Use each adapter's `getProjectSkillDir()` to determine additional skill directories. This keeps the logic adapter-driven rather than hardcoding CLI names.

```
Current flow:
  installExternalFiles(projectRoot, devAdapters, skipPrompts)
    → installSkillsWithChecksums(projectRoot, skipPrompts)     // always .claude/skills/
    → installHooksForAdapters(...)

New flow:
  installExternalFiles(projectRoot, devAdapters, skipPrompts)
    → installSkillsWithChecksums(projectRoot, '.claude/skills', skipPrompts, updateAllState)
    → for each adapter with getProjectSkillDir() != null && dir != '.claude/skills':
        → installSkillsWithChecksums(projectRoot, adapter.getProjectSkillDir(), skipPrompts, updateAllState)
    → installHooksForAdapters(...)
```

The `updateAllState` object is shared across calls so "update all" carries across directories.

### D3: Three-tier post-init instruction output

Split `printPostInitInstructions` into three categories:
1. **Native CLIs** (claude, cursor): `/gauntlet-setup` invocation
2. **Codex**: `.agents/skills/` path references
3. **Other non-native** (gemini, github-copilot): `@.claude/skills/` path references (existing behavior)

Pass `devCLINames` as today, detect codex by name.

### D4: CodexAdapter returns `.agents/skills` from `getProjectSkillDir()`

Simple one-line change. This is the canonical way adapters declare their skill directory. The init flow uses this to discover where to install.

### D5: "Update all" option via shared mutable state

Change `promptFileOverwrite` to return a three-way result: `'yes' | 'no' | 'all'`. Use `@inquirer/prompts` `select` instead of `confirm` to support three options:

```
Skill `gauntlet-run` has changed, update it?
  ❯ Yes
    No
    Yes to all remaining
```

Pass a mutable `{ updateAll: boolean }` object through `installSkillsWithChecksums`. Once the user selects "all", set the flag and skip prompts for remaining skills. The state object is shared across calls to `installSkillsWithChecksums` (D2), so "update all" carries from `.claude/skills/` into `.agents/skills/`.

## Risks / Trade-offs

- **Duplicate skill files**: Skills are copied to both `.claude/skills/` and `.agents/skills/`. This uses slightly more disk space but avoids symlink complexity and keeps each directory self-contained. The total size is small (9 skills, mostly markdown).
- **`.agents/` directory ownership**: Creating `.agents/skills/` in a project that doesn't use Codex yet is harmless, but we avoid this by only installing when codex is a selected dev CLI.
- **Prompt UX change**: Switching from `confirm` to `select` for overwrite changes the interaction slightly (arrow keys vs y/n). Worth it for the "update all" capability.

## Migration Plan

No migration needed. This is additive:
- Existing `.claude/skills/` installation is unchanged
- `.agents/skills/` is only created when codex is selected
- Overwrite prompt adds options but defaults remain the same
- No config schema changes

## Open Questions

None.
