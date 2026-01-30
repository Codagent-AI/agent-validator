# Change: Add prompt configurability for reviews and checks

## Why
Reviews currently only support inline markdown prompts, and checks only support file-based fix instructions. Users need the flexibility to source review prompts from external files or CLI skills, and to specify fix strategies via skills, enabling prompt reuse across projects and integration with existing CLI tooling.

## What Changes
- Reviews support three mutually exclusive prompt sources: inline markdown body (current), `prompt_file` (external file path), or `skill_name` (CLI skill)
- Reviews directory supports `.yml` files alongside existing `.md` files
- **BREAKING**: Check `fix_instructions` field renamed to `fix_instructions_file` (deprecated alias kept)
- Checks gain `fix_with_skill` as a mutually exclusive alternative to `fix_instructions_file`
- File paths (`prompt_file`, `fix_instructions_file`) accept both absolute and relative paths; absolute paths log a security warning

## Impact
- Affected specs: `check-config`, new `review-config`
- Affected code: `src/config/schema.ts`, `src/config/types.ts`, `src/config/loader.ts`, `src/config/validator.ts`, `src/gates/review.ts`, `src/gates/check.ts`, `src/gates/result.ts`
