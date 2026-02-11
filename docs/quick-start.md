# Quick Start

## Requirements

- **Node.js** (v18.0.0+)
- **git** (change detection and diffs)
- For reviews: one or more supported AI CLIs installed (`gemini`, `codex`, `claude`, `github-copilot`, `cursor`). For the full list of tools and how they are used, see [CLI Invocation Details](cli-invocation-details.md)

## Installation

```bash
npm install -g agent-gauntlet
```

## Initialization

Initialize configuration in your project root:

```bash
agent-gauntlet init
```

This creates the `.gauntlet/` directory with a config skeleton and the built-in code-quality review (see [Configuration Layout](#configuration-layout)). It prompts you to select which CLIs to use, auto-detects the base branch, installs skills for your AI agents, and auto-installs stop hooks for Claude Code and Cursor.

After init, configure your checks and reviews by running the setup skill in your AI agent session:

```
/gauntlet-setup
```

The setup skill scans your project, discovers available tooling (linters, test runners, type checkers, etc.), and configures checks and entry points in `.gauntlet/config.yml`. See the [Skills Guide](skills-guide.md) for details.

## Configuration Concepts

Agent Gauntlet uses three core concepts:

- **Entry points**: Paths in your repository (e.g., `src/`, `docs/plans/`) that Gauntlet monitors for changes.
- **Checks**: Shell commands that run when an entry point changes — things like tests, linters, and type-checkers.
- **Reviews**: AI-powered code reviews requested via CLI tools like Codex, Claude, or Gemini. Each review uses a custom prompt you define.

When you run `agent-gauntlet`, it detects which entry points have changed files and runs the associated checks and reviews.

## Basic Usage

- **Run gates for detected changes**

```bash
agent-gauntlet run
```

- **Run gates from your agent and auto-fix detected issues**

```
/gauntlet-run
```

## Agent Skills

Agent Gauntlet can install skills (for Claude Code) and flat commands (for other CLI agents) that let you invoke gauntlet workflows directly from your AI agent session. For example, `/gauntlet-help` provides guidance and troubleshooting on how to use the tool. See the [Skills Guide](skills-guide.md) for the full list of skills and configuration options.

## Configuration Layout

Agent Gauntlet loads configuration from your repository:

```text
.gauntlet/
  config.yml          # entry_points starts as [] after init
  checks/             # populated by /gauntlet-setup or manually
  reviews/
    code-quality      # created by init
```

- **Project config**: `.gauntlet/config.yml`
- **Check definitions**: `.gauntlet/checks/`
- **Review definitions**: `.gauntlet/reviews/`

## Example Configuration

After running `agent-gauntlet init`, your `config.yml` starts with empty entry points:

```yaml
base_branch: origin/main
log_dir: gauntlet_logs
cli:
  default_preference:
    - claude
    - gemini
# entry_points configured by /gauntlet-setup
entry_points: []
```

After running `/gauntlet-setup`, a real-world configuration might look like this:

### config.yml

```yaml
base_branch: origin/main
log_dir: gauntlet_logs
allow_parallel: true
cli:
  default_preference:
    - codex
    - claude
    - gemini
entry_points:
  - path: "src"
    checks:
      - test
      - lint
      - security-code
    reviews:
      - code-quality
  - path: "package.json"
    checks:
      - security-deps
  - path: "internal-docs/plans"
    reviews:
      - plan-review
```

**What each section does:**

| Section | Purpose |
|---------|---------|
| `base_branch` | The branch to compare against when detecting changes (usually `origin/main`) |
| `log_dir` | Where Gauntlet writes log files for each run |
| `allow_parallel` | Run checks and reviews concurrently for faster feedback |
| `cli.default_preference` | Ordered list of AI CLIs to try for reviews — uses the first available one |
| `entry_points` | Maps paths to the checks and reviews that run when those paths change |

In this example:
- Changes to `src/` trigger tests, linting, security checks, **and** an AI code review
- Changes to `package.json` trigger a dependency security audit
- Changes to `internal-docs/plans/` trigger an AI plan review (no code checks needed)

### Check definition example

Checks are shell commands defined in `.gauntlet/checks/`:

```yaml
# .gauntlet/checks/lint.yml
name: lint
command: bunx biome check src
working_directory: .
parallel: true
run_in_ci: true
run_locally: true
timeout: 60
```

The check name (`lint`) is referenced in `config.yml`. When Gauntlet runs this check, it executes the `command` and reports pass/fail based on exit code.

### Review definition example

Reviews are prompts defined in `.gauntlet/reviews/`:

```markdown
# .gauntlet/reviews/code-quality.md

# Code Review

Review the diff for code quality issues. Focus on:
- Code correctness and potential bugs
- Code style and consistency
- Best practices and maintainability
- Performance considerations
```

The filename (`code-quality.md`) becomes the review name referenced in `config.yml`. Gauntlet passes this prompt — along with the diff of changed files — to the AI CLI.

**Per-review CLI preference:** You can override the default CLI preference for specific reviews using YAML frontmatter:

```markdown
---
cli_preference:
  - gemini
  - codex
---

# Plan Review
Review this plan for completeness and potential issues.
```

This is useful when you want a specific LLM for certain types of reviews — for example, using Gemini for plan reviews but Codex for code reviews.

## Logs

Each job writes a log file under `log_dir` (default: `gauntlet_logs/`). Filenames are derived from the job id (sanitized).

## CI Setup (Optional)

To run your checks in GitHub Actions:

```bash
agent-gauntlet ci init
```

This creates:
- `.gauntlet/ci.yml` — CI-specific configuration (services, runtimes, setup steps)
- `.github/workflows/gauntlet.yml` — GitHub Actions workflow file

Your local check definitions (`.gauntlet/checks/`) are automatically used in CI. The `ci.yml` file lets you configure additional CI-specific settings like database services or runtime versions.

## Stop Hook (Claude Code & Cursor Integration)

The stop hook automatically runs the gauntlet when an AI agent tries to stop working, ensuring all gates pass before completion.

**Automatic setup:** Stop hooks are auto-installed by `agent-gauntlet init` for Claude Code (`.claude/settings.local.json`) and Cursor (`.cursor/hooks.json`) when they are among the selected CLIs. No manual configuration is needed.

**Manual setup for Claude Code** (if not using `init`):

Add this to your Claude Code settings (`.claude/settings.json` or via `claude settings`):

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": ["agent-gauntlet stop-hook"]
      }
    ]
  }
}
```

When the agent tries to stop, the hook runs the gauntlet. If gates fail, the agent is directed to fix issues before stopping.

For detailed configuration options, troubleshooting, and advanced usage, see the [Stop Hook Guide](stop-hook-guide.md).

## Further Reading
- [User Guide](user-guide.md) — full usage details
- [Skills Guide](skills-guide.md) — gauntlet skills for AI agents
- [Configuration Reference](config-reference.md) — all configuration fields + defaults
- [CLI Invocation Details](cli-invocation-details.md) — how we securely invoke AI CLIs
- [Stop Hook Guide](stop-hook-guide.md) — stop hook configuration and troubleshooting
