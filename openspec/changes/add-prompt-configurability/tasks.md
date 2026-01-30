## 1. Schema Updates
- [x] 1.1 Update `checkGateSchema` in `src/config/schema.ts`: add `fix_instructions_file`, `fix_with_skill`, keep deprecated `fix_instructions`, convert to `.superRefine()` with mutual exclusivity and alias normalization
- [x] 1.2 Update `reviewPromptFrontmatterSchema` in `src/config/schema.ts`: add `prompt_file` and `skill_name` with mutual exclusivity refine
- [x] 1.3 Add `reviewYamlSchema` in `src/config/schema.ts`: same fields as frontmatter but requires exactly one of `prompt_file` or `skill_name`

## 2. Type Updates
- [x] 2.1 Add `fixWithSkill` to `LoadedCheckGateConfig` in `src/config/types.ts`
- [x] 2.2 Create `LoadedReviewGateConfig` interface in `src/config/types.ts` with `promptContent`, `skillName`, and all frontmatter fields
- [x] 2.3 Update `LoadedConfig.reviews` type to use `LoadedReviewGateConfig`

## 3. Loader Updates
- [x] 3.1 Add `loadPromptFile` helper in `src/config/loader.ts` (absolute/relative resolution with warning)
- [x] 3.2 Update check loading in `src/config/loader.ts`: normalize deprecated alias, load `fix_instructions_file`, store `fixWithSkill`
- [x] 3.3 Update review loading in `src/config/loader.ts`: handle `.yml`/`.yaml` files, detect duplicate names, load `prompt_file`/`skill_name`
- [x] 3.4 Remove path traversal restriction for `fix_instructions_file` (allow paths outside `.gauntlet/`)

## 4. Gate Result and Executor Updates
- [x] 4.1 Add `fixWithSkill` to `GateResult` in `src/gates/result.ts`
- [x] 4.2 Update `CheckGateExecutor` in `src/gates/check.ts` to set `fixWithSkill` on failure results and log skill info
- [x] 4.3 Update `ReviewGateExecutor` types in `src/gates/review.ts` to use `LoadedReviewGateConfig`

## 5. Validator Updates
- [x] 5.1 Update `src/config/validator.ts` to handle `.yml`/`.yaml` review files
- [x] 5.2 Add duplicate review name detection in validator
- [x] 5.3 Update CLI preference cross-reference for both `.md` and `.yml` reviews

## 6. Tests
- [x] 6.1 Test: YAML review with `prompt_file` loads content
- [x] 6.2 Test: YAML review with `skill_name` sets skillName
- [x] 6.3 Test: YAML review rejects both `prompt_file` and `skill_name`
- [x] 6.4 Test: YAML review rejects neither `prompt_file` nor `skill_name`
- [x] 6.5 Test: MD review with `prompt_file` in frontmatter overrides body
- [x] 6.6 Test: MD review with `skill_name` in frontmatter
- [x] 6.7 Test: MD review rejects both `prompt_file` and `skill_name` in frontmatter
- [x] 6.8 Test: Check valid definition (filename-derived name, no name attribute)
- [x] 6.9 Test: Check with name attribute is ignored (identified by filename)
- [x] 6.10 Test: Check with `fix_instructions_file` loads content
- [x] 6.11 Test: Check with deprecated `fix_instructions` alias works
- [x] 6.12 Test: Check with `fix_with_skill` stores skill name
- [x] 6.13 Test: Check rejects `fix_instructions_file` + `fix_with_skill`
- [x] 6.14 Test: Check rejects `fix_instructions` + `fix_instructions_file`
- [x] 6.15 Test: Absolute path works with warning
- [x] 6.16 Test: Missing prompt file throws error
- [x] 6.17 Test: Duplicate review name throws error

## 7. Documentation
- [x] 7.1 Update `docs/config-reference.md` with new fields: `prompt_file`, `skill_name` (reviews), `fix_instructions_file`, `fix_with_skill` (checks), and deprecation notice for `fix_instructions`

## 8. Validation
There are no validation tasks that need to be explicitly run. When work is completed, a stop hook should execute the full gauntlet of verification tasks and give direction on what needs to be fixed.
