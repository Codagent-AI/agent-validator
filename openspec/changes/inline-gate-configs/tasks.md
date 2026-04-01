## 1. Schema & Config Loader

- [ ] 1.1 Add optional top-level `checks` map to config Zod schema in `src/config/schema.ts`
- [ ] 1.2 Add optional top-level `reviews` map to config Zod schema in `src/config/schema.ts`
- [ ] 1.3 Update config loader to merge inline checks with file-based checks; error on name collision
- [ ] 1.4 Update config loader to merge inline reviews with file-based reviews; error on name collision

## 2. Init

- [ ] 2.1 Update `src/commands/init.ts` to write `code-quality` inline in `config.yml` under the `reviews` map instead of creating `.validator/reviews/code-quality.yml`
- [ ] 2.2 Remove creation of `.validator/checks/` directory from init
- [ ] 2.3 Remove creation of `.validator/reviews/` directory from init

## 3. Validator-Setup Skill

- [ ] 3.1 Update validator-setup skill to write discovered checks inline in `config.yml` under the `checks` map instead of creating separate `.validator/checks/*.yml` files
- [ ] 3.2 Remove code-quality review setup from validator-setup (handled by init)

## 4. Project Config Migration

- [ ] 4.1 Add inline `checks` map to `.gauntlet/config.yml` with all 9 checks (omitting default-value attributes)
- [ ] 4.2 Add inline `reviews` map to `.gauntlet/config.yml` with `code-quality: {builtin: code-quality, num_reviews: 1}`
- [ ] 4.3 Delete all `.gauntlet/checks/*.yml` files (build, lint, test, typecheck, security-code, security-deps, schema-validate, openspec-validate, no-orphaned-design-docs)
- [ ] 4.4 Delete `.gauntlet/reviews/code-quality.yml`

## 5. Docs & Examples

- [ ] 5.1 Update `docs/config-reference.md` to document inline `checks` and `reviews` maps; mark file-per-gate as "also supported"
- [ ] 5.2 Update `docs/user-guide.md` examples to use inline style
- [ ] 5.3 Update any other docs or examples showing `.validator/checks/*.yml` or `.validator/reviews/*.yml` patterns

## 6. Tests

- [ ] 6.1 Add test: inline check is loaded and available for entry point reference
- [ ] 6.2 Add test: inline check with only `command` applies correct defaults
- [ ] 6.3 Add test: name collision between inline and file-based check produces validation error
- [ ] 6.4 Add test: file-based checks coexist with inline checks
- [ ] 6.5 Add test: inline review is loaded and available for entry point reference
- [ ] 6.6 Add test: inline review with only `builtin` applies correct defaults
- [ ] 6.7 Add test: name collision between inline and file-based review produces validation error
- [ ] 6.8 Add test: invalid inline check (missing command) produces validation error at config load
- [ ] 6.9 Add test: invalid inline review (no prompt source) produces validation error at config load
