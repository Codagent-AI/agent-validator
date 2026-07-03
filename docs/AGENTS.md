---
title: Documentation Authoring Guide
group: Development
order: 99
description: Format and structure for docs that sync to codagent.dev.
---

# Documentation Authoring Guide

These instructions apply to Markdown files in this `docs/` directory. The docs sync workflow copies these files into the codagent.dev docs site, where the site generator renders them into the product documentation.

## File Structure

- Use one public topic per Markdown file.
- Use lowercase kebab-case filenames, such as `quickstart.md` or `cli-reference.md`.
- Keep repo-facing indexes in `README.md`; the docs site skips `README.md` and uses `introduction.md` as the product landing page.
- Put images under `docs/images/` and reference them with relative paths like `images/workflow.png`.
- Keep `CLAUDE.md` as a symlink to `AGENTS.md`; edit `AGENTS.md` directly.

## Page Metadata

Public docs should start with simple YAML frontmatter:

```yaml
---
title: Page Title
group: Getting Started
order: 1
description: One sentence summary for previews and metadata.
---
```

Supported groups are `Getting Started`, `Guides`, `Usage`, `Configuration`, `Reference`, `Operations`, `Evaluation`, and `Development`. Pages inside a group are sorted by `order`; use larger numbers for less prominent pages.

## Markdown Style

- Start the page body with exactly one `#` heading that matches the page title.
- Use `##` headings for the table of contents; lower headings are fine inside a section.
- Use relative links to other docs, such as `[Quickstart](quickstart.md)`.
- Use fenced code blocks with a language tag, such as `bash`, `yaml`, `json`, or `text`.
- Prefer tables for compact reference material and ordered lists for procedures.
- Do not use raw HTML; the docs site Markdown renderer disables embedded HTML.

## Content Expectations

- Write for users of the released tool first, then for contributors.
- Keep current behavior sourced from code first, then current OpenSpec specs, then docs.
- Avoid documenting historical or archived behavior as current behavior.
- Mention platform or install prerequisites before commands that depend on them.
- When adding a page that should be easy to find, give it frontmatter with the right group and order instead of relying on filename order.
