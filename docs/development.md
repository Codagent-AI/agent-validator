# Development

## Feature Implementation Workflow

- Uses superpowers skills for brainstorming, planning, and implementation
- Uses [worktrunk](https://worktrunk.dev) for worktree management
- Uses AgentGauntlet to validate changes
- Uses OpenSpec to preserve spec history

### 1. Research

Determine feasibility, viability, and high level approach.

Use Paul Caplan's research skill:
```
/research
```

### 2. Brainstorm

Flesh out the details using the superpowers brainstorming skill:
```
/brainstorm
```

Produces `docs/plans/YYYY-MM-DD-<topic>-design.md`

### 3. Spec

Write up a "change proposal" to capture the changes to the specification.

Use a modified version of OpenSpec that writes a proposal and spec but does not create a design doc or tasks doc - both are redundant with superpowers:
```
/openspec:proposal
```

Produces `openspec/changes/<change-name>/proposal.md` and updated spec files

### 4. Plan

Write the plan:
```
/plan
```

Produces `docs/plans/YYYY-MM-DD-<name>.plan.md`

### 5. Implement

**Preferred Execution Mode**: Fresh context window in an isolated worktree, with subagent-driven execution. Best of both worlds.

**Steps:**

1. Create a worktree and launch an agent:
   ```bash
   wt switch -c feat-name -b main -x claude
   ```

2. In the worktree agent session, tell it to use subagent-driven-development:
   ```
   /subagent-driven-development execute docs/plans/YYYY-MM-DD-<name>.plan.md
   ```

3. The agent will run all tasks autonomously with automated spec + quality reviews. It only pauses if a subagent has a question.

4. When complete, create a pull request against main branch. Use Paul Caplan's /push-pr skill:
   ```
   /push-pr
   ```

**Note:** `docs/plans/` and `docs/design/` are gitignored — plan and design docs are scratch artifacts, not permanent documentation.

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
