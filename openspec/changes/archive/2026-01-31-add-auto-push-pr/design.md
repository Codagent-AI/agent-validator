# Design: add-auto-push-pr

## Context

The gauntlet stop hook currently runs local quality gates and either blocks or approves the agent's stop attempt. This change extends the workflow so that after gates pass, the agent is instructed to create or update a PR before stopping — bridging the gap between "local quality" and "PR submitted."

The stop hook already supports the pattern of blocking with instructions (used for `failed` status). This change adds a new status (`pr_push_required`) that blocks with push-pr instructions instead of fix instructions.

## Pre-factoring

CodeScene hotspot analysis for files modified by this change:

| File | Score | Status |
|------|-------|--------|
| `src/commands/stop-hook.ts` | 7.07 (Yellow) | Bumpy Road, Complex Method (cc=36), Large Method (240 LoC) in `registerStopHookCommand` |
| `src/commands/init.ts` | 6.28 (Yellow) | Bumpy Road, Complex Method in `promptAndInstallCommands` (cc=24), `installCommands` (cc=14), Large Methods |
| `src/config/stop-hook-config.ts` | 9.24 (Green) | Healthy |
| `src/config/schema.ts` | 10.0 (Optimal) | Healthy |
| `src/config/global.ts` | 9.53 (Green) | Healthy |
| `src/types/gauntlet-status.ts` | 10.0 (Optimal) | Healthy |

**Strategy:** No refactoring of existing code is planned. `stop-hook.ts` and `init.ts` are already complex — new PR workflow logic will be added in extracted helper functions (`checkPRStatus`, `getPushPRInstructions`) rather than expanding the main action handler. Template installation in `init.ts` will extend the existing pattern minimally.

## Goals / Non-Goals

**Goals:**
- Enable autonomous PR creation/update after gauntlet passes
- Follow existing config precedence pattern (env > project > global)
- Graceful degradation when `gh` CLI is unavailable
- Instruction-first approach: tell agent to look for project-level skills before falling back

**Non-Goals:**
- CI monitoring (deferred to `add-auto-fix-pr`)
- Automatic merging
- Force-pushing or branch management

## Decisions

### 1. `auto_push_pr` Setting

| Setting | Type | Default | Env Var |
|---------|------|---------|---------|
| `auto_push_pr` | boolean | `false` | `GAUNTLET_AUTO_PUSH_PR` (`true`/`1`/`false`/`0`) |

Three-tier precedence matching existing `enabled` and `run_interval_minutes` pattern:
- **Environment variable** (highest): `GAUNTLET_AUTO_PUSH_PR`
- **Project config**: `.gauntlet/config.yml` → `stop_hook.auto_push_pr`
- **Global config**: `~/.config/agent-gauntlet/config.yml` → `stop_hook.auto_push_pr`

### 2. Stop Hook Post-Gauntlet Flow

After gauntlet returns success (`passed` or `passed_with_warnings`) and `auto_push_pr` is enabled:

```
gauntlet passes
  → auto_push_pr enabled?
    → yes: check PR status via `gh pr view` + git remote comparison
      → no PR exists: block with `pr_push_required` + push-pr instructions
      → PR exists but not up to date (local commits not pushed): block with `pr_push_required` + push-pr instructions
      → PR exists and up to date: approve stop (original behavior)
    → no: approve stop (original behavior)
```

PR detection is stateless — each invocation checks PR existence and compares local HEAD with remote.

### 3. `checkPRStatus()` Helper

Checks both PR existence and whether local commits have been pushed. Returns an object with PR state info.

Implementation approach:
- Run `gh pr view --json number,state,headRefOid` to get PR info and its head SHA
- Compare PR head SHA with local `git rev-parse HEAD` to determine if up to date
- If no PR exists: return status indicating PR needs creation
- If PR exists but head SHAs differ: return status indicating push needed
- If PR exists and SHAs match: return status indicating up to date

Error handling:
- `gh` not installed → log warning, approve stop (graceful degradation)
- `gh pr view` fails (network, auth, no remote) → log warning with details, approve stop (graceful degradation)

### 4. Push-PR Instruction Strategy

The `reason` prompt returned when blocking with `pr_push_required` is generic — it covers both creating a new PR and updating an existing one:
1. First: look for project-level instructions or skill
2. Fallback: minimal git add, commit, push, `gh pr create` instructions (`gh` availability is a prerequisite for fallback)
3. If `passed_with_warnings`: include skipped issues in PR description guidance
4. After PR creation/update: instruct agent to try stopping again

### 5. Template Command

One template file installed during `agent-gauntlet init`:
- `.gauntlet/push_pr.md` — simplified push-pr (skill-first lookup, minimal fallback)

Gets symlinked to `.claude/commands/push-pr.md` following the existing `run_gauntlet.md` pattern. Existing files are not overwritten.

## Alternatives Considered

1. **Always push PR after gates pass** — Rejected: too aggressive, not all gauntlet sessions intend to create PRs
2. **Separate CLI command instead of stop hook integration** — Rejected: defeats the purpose of autonomous end-to-end workflow
3. **Track PR-pushed state via marker file** — Rejected: stateless `gh pr view` + git SHA check is simpler and more reliable
4. **Only check PR existence, not up-to-date status** — Rejected: would approve stop even when local commits haven't been pushed to the PR, leaving the PR stale

## Risks / Trade-offs

- **`gh` CLI dependency**: PR detection requires `gh`. Mitigated by graceful degradation (log warning, approve stop).
- **Branch naming**: `gh pr view` finds PRs by current branch. If the branch has no remote tracking, it may fail. Handled by the `checkPRStatus()` error handling (graceful degradation on any error).
- **SHA comparison**: Comparing local HEAD with PR head SHA assumes the agent is working on the same branch the PR targets. This is the expected workflow.
