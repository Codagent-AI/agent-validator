# Development

## Feature Implementation Workflow

- Uses superpowers skills for brainstorming, planning, and implementation
- Uses [worktrunk](https://worktrunk.dev) for worktree management
- Uses AgentGauntlet to validate changes
- Uses OpenSpec to preserve spec history

### 0. Create a worktree and launch an agent

```bash
wt switch -c feat-name -b main -x claude
```

### 1. Research

Use Paul Caplan's research skill to determine feasibility, viability, and high-level approach. Evaluate whether the idea is worth building and identify key risks or unknowns before investing in detailed design.
```
/research
```

### 2. Brainstorm

Flesh out the details of the feature with a structured design session. The superpowers brainstorming skill explores requirements, edge cases, and implementation approach, producing a design doc that feeds into the spec process.
```
/brainstorm
```

Produces `docs/plans/YYYY-MM-DD-<topic>-design.md`

### 3. Spec + Review

Write up a "change proposal" and review it. The design doc from step 2 is moved into the openspec change directory and used as input for proposal and spec deltas. After validation, the gauntlet spec reviewer runs automatically.
```
/clear
/openspec:proposal write proposal for docs/plans/<file>.md and then invoke `gauntlet-run` skill
```

Produces `openspec/changes/<change-name>/` containing `design.md` (moved from docs/plans/), `proposal.md`, and spec deltas. The proposal is the source of truth from this point forward.

### 4. Plan + Implement (one-shot)

The worktree agent writes a detailed implementation plan and immediately executes it without pausing. Each task is dispatched to a fresh subagent with automated spec compliance and code quality reviews. 

```
/clear
/superpowers:write-plan Read all files in openspec/changes/<change>, then make a plan, then immediately execute it using the subagent-driven-development skill. No parallel subagents.
```

The agent will:
1. Write the plan (`docs/plans/YYYY-MM-DD-<name>.plan.md`)
2. Execute all tasks via fresh subagents with automated spec + quality reviews
3. Run `gauntlet-run` skill to validate
4. Create a pull request against main

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
