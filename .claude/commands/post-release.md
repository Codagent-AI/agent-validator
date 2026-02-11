# /post-release — Verify publish and sync dev branch

Run this after merging a release PR to main. Confirms the npm publish succeeded, then syncs `dev` with `main`.

## Steps

### 1. Read the expected version

```bash
git checkout main
git pull origin main
NEW_VERSION=$(node -p "require('./package.json').version")
echo "Expected version: $NEW_VERSION"
```

### 2. Verify npm publish

```bash
npm view agent-gauntlet version
```

Compare the npm version to `$NEW_VERSION`. If they don't match, check the GitHub Actions publish workflow for errors:

```bash
gh run list --workflow=publish.yml --limit 3
```

If the latest run failed, show the user the failure URL and stop. Do not proceed until the package is confirmed published.

### 3. Sync dev with main

```bash
git checkout dev
git pull origin dev
git merge main --no-edit
```

If the merge has conflicts, stop and tell the user to resolve them manually.

### 4. Push dev

```bash
git push origin dev
```

### 5. Confirm

Print a summary:
- Published version on npm
- Current branch (`dev`)
- Merge result
