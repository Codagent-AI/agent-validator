# Development

## Install dependencies

```bash
bun install
```

## Build the CLI binary

```bash
bun run build
```

## Parallel Workflow

Uses [worktrunk](https://worktrunk.dev) (`wt`) to manage git worktrees for parallel development.

**Branch strategy (trunk-based):**
- `main` — trunk branch in the main checkout (`~/paul/agent-gauntlet/`). All PRs merge here.
- Feature branches — created as worktrees off `main`. Used for implementation and testing.

**Creating a feature worktree:**

```bash
wt switch -b main -c feat-name
```

This creates `~/paul/agent-gauntlet.feat-name/`, runs `bun install`, and switches into it.

**Launching an agent in a worktree:**

```bash
wt switch -b main -x claude -c feat-name
```

**Switching between worktrees:**

```bash
wt switch main           # back to main checkout
wt switch feat-name      # back to feature
wt switch -              # toggle previous
```

**Merging a feature back:**

```bash
wt merge
```

Commits uncommitted changes, squashes all commits, runs `bun src/index.ts check`, merges to `main`, and removes the worktree.

**Listing worktrees:**

```bash
wt list
```

## Release Workflow

Releases are driven by the `/release` slash command in Claude Code.

### How it works

Run `/release` from the project root. The command will:

1. Find the last release tag (`v*`)
2. Query all PRs merged to `main` since that tag
3. Generate a changeset file for each PR (bump type derived from conventional commit prefix)
4. Run `changeset version` to update `CHANGELOG.md` and bump `package.json`
5. Create a release PR (e.g., `chore: release v1.0.0`)

### Publishing

When the release PR is merged to `main`, the publish workflow automatically:
- Checks if the version is already published on npm
- Publishes the new version to npm (`npm publish`)
- Creates a GitHub release (`softprops/action-gh-release`)

One merge → publish. No manual changeset creation needed.
