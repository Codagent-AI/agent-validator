# Add Codex skill installation and update-all prompt

## Summary

Update the init command to install skills to Codex's `.agents/skills/` directory when codex is selected as a dev CLI, add an "update all" option to the skill overwrite prompt, and show Codex-native paths in post-init instructions.

## Files to modify

- `src/cli-adapters/codex.ts` — `getProjectSkillDir()` returns `.agents/skills`
- `src/commands/init-prompts.ts` — Change `promptFileOverwrite` from `confirm` (yes/no) to `select` (yes/no/all), returning `'yes' | 'no' | 'all'`
- `src/commands/init.ts`:
  - Parameterize `installSkillsWithChecksums` to accept `targetBaseDir` and a shared `{ updateAll: boolean }` state object
  - In `installExternalFiles`, call `installSkillsWithChecksums` for `.claude/skills/` (always), then for each dev adapter's `getProjectSkillDir()` that isn't `.claude/skills/`
  - When `updateAll` is true or `skipPrompts` is true, skip the prompt
  - Update `printPostInitInstructions` to have three tiers: native CLIs (`/gauntlet-setup`), codex (`.agents/skills/` paths), other non-native (`@.claude/skills/` paths)

## Implementation details

### CodexAdapter (D4)
```typescript
getProjectSkillDir(): string | null {
  return '.agents/skills';
}
```

### promptFileOverwrite (D5)
Change return type from `Promise<boolean>` to `Promise<'yes' | 'no' | 'all'>`. Use `select` from `@inquirer/prompts` with three choices: "Yes", "No", "Yes to all remaining". Update call sites in `installSkillsWithChecksums`.

### installSkillsWithChecksums (D1, D2)
New signature:
```typescript
async function installSkillsWithChecksums(
  projectRoot: string,
  targetBaseDir: string,
  skipPrompts: boolean,
  updateAllState: { updateAll: boolean },
): Promise<void>
```

Logic per skill:
1. Target doesn't exist → copy, log "Created"
2. Checksums match → skip silently
3. Checksums differ:
   - If `skipPrompts` or `updateAllState.updateAll` → overwrite
   - Else prompt → `'yes'` overwrites, `'all'` sets `updateAllState.updateAll = true` and overwrites, `'no'` skips

### installExternalFiles (D2)
```typescript
async function installExternalFiles(
  projectRoot: string,
  devAdapters: CLIAdapter[],
  skipPrompts: boolean,
): Promise<void> {
  const updateAllState = { updateAll: false };
  await installSkillsWithChecksums(projectRoot, path.join('.claude', 'skills'), skipPrompts, updateAllState);
  const seen = new Set([path.join('.claude', 'skills')]);
  for (const adapter of devAdapters) {
    const dir = adapter.getProjectSkillDir();
    if (dir && !seen.has(dir)) {
      seen.add(dir);
      await installSkillsWithChecksums(projectRoot, dir, skipPrompts, updateAllState);
    }
  }
  await installHooksForAdapters(projectRoot, devAdapters, skipPrompts);
}
```

### printPostInitInstructions (D3)
Three categories:
1. Native (claude, cursor) → `/gauntlet-setup` message
2. Codex → `.agents/skills/<name>/SKILL.md` listing
3. Other non-native → `@.claude/skills/<name>/SKILL.md` listing (existing behavior)

## Tests

- Unit test: `CodexAdapter.getProjectSkillDir()` returns `.agents/skills`
- Unit test: `promptFileOverwrite` returns `'all'` when user selects "Yes to all remaining"
- Integration: `init -y` with codex available creates `.agents/skills/` with all skills
- Integration: `init -y` without codex skips `.agents/skills/`
- Integration: re-run with unchanged skills skips both directories silently

## Spec coverage

- Requirement: Init installs skills to Codex skill directory (all 5 scenarios)
- Requirement: CodexAdapter reports project skill directory (1 scenario)
- Requirement: Skill overwrite prompt supports update-all option (all 3 scenarios)
- Requirement: Init outputs next-step message — modified (all 6 scenarios)
