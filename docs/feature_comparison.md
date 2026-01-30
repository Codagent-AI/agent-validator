# Feature Comparison

This document compares Agent Gauntlet's features with other popular AI-powered code review tools.

## Comparison Table

| Feature | Agent Gauntlet | Other Tools |
| :--- | :--- | :--- |
| **Agentic Feedback Loop** | ✅ Real-time feedback directly to coding agents during development | ❌ Async (PR/CI based) |
| **Custom Static Checks** | ✅ Run your own build, lint, test commands | ❌ Pre-configured linters/SAST only |
| **AI Review Context** | ✅ Full codebase (via dynamic tool access) | ✅ Full codebase |
| **AI Provider** | ✅ **BYO Model** - Uses your existing CLI tools | ❌ SaaS platform subscription required |
| **Multi-Agent Review** | ✅ Multiple AI tools can review same changes | ❌ Single platform |
| **Run Locally** | ✅ Yes (primary mode) | ✅ Yes (CLI or IDE) |
| **CI / PR Comments** | ❌ No (focus is on agentic workflow) | ✅ Mature PR integrations |
| **Stop Hook Integration** | ✅ Prevents agent completion until checks pass | ❌ No |
| **Pricing** | ✅ **Free** (OSS) | $$ Paid SaaS (~$30/user/month) |
| **Self-Hosted** | ✅ Fully local | ✅ Enterprise tier |
| **Maturity** | ⚠️ Emerging | ✅ Mature |

## Key Differentiators

### Agent Gauntlet Advantages

1. **Real-Time Feedback for Autonomous Agents**: Unlike other tools that sit in CI or PR workflows, Agent Gauntlet provides immediate feedback loops for coding agents. When an agent completes work, it gets instant validation and can iterate until checks pass—without human intervention.

2. **Hybrid Validation**: Combines deterministic static checks (build, lint, test) with probabilistic AI reviews (code quality, logic bugs) in a single pipeline. Other tools typically focus on one or the other.

3. **BYO AI (Bring Your Own)**: Leverage your existing CLI tools and API keys rather than being locked into a specific SaaS provider's model. This means no additional subscription costs.

4. **Multi-Agent Code Review**: Unique ability to have one AI agent review another's work. Configurable via `num_reviews` and `cli_preference`.

5. **Stop Hook Integration**: Integrates with agent stop hooks to automatically block completion until all checks pass—creating an enforced quality gate in the agent workflow.

6. **Free and Open Source**: No per-seat licensing or usage-based pricing. The tool is free; you only pay for the AI CLI tools you already have.

### Where Other Tools Excel

1. **PR Comment Integration**: Mature integrations that post inline comments directly on pull requests—useful for human-driven review workflows.

2. **Pre-Configured Analysis**: Dozens of linters and security scanners work out-of-the-box without configuration.

3. **Enterprise Features**: SOC2 compliance, SSO, granular permissions, and dedicated support are more mature in established tools.

4. **Codebase Intelligence**: Sophisticated function/class graphs and cross-repo context engines.
