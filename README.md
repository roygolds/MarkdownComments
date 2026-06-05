# MarkdownComments

MarkdownComments is a project for adding collaborative commenting features to Markdown files, similar to Microsoft Word and Google Docs comments while preserving Markdown as the source of truth.

## Goals

- Add comments, replies, resolution state, and authorship metadata to `.md` documents.
- Keep Markdown files readable and version-control friendly.
- Support stable comment anchors that survive common edits.
- Design for local-first workflows, editor integrations, and future collaboration backends.
- Make the repository easy for AI agents and human contributors to understand.

## Repository map

| Path | Purpose |
| --- | --- |
| `AGENTS.md` | Operating instructions for AI coding agents. |
| `.github\copilot-instructions.md` | Copilot-specific repository guidance. |
| `docs\product-brief.md` | Product goals, users, workflows, and open questions. |
| `docs\architecture.md` | Initial architecture notes and technical direction. |
| `docs\squad.md` | Human-readable squad roster and collaboration model. |
| `squad\agents.yml` | Machine-readable squad definition. |

## Initial product direction

The first implementation should prove that Markdown comments can be stored separately from the document body, anchored to meaningful text ranges, rendered in an editor-like UI, and synchronized safely with normal Git-based Markdown editing.

## AI collaboration

AI agents should start with `AGENTS.md`, then read the relevant files in `docs\` and `squad\agents.yml` before making changes. Significant product, architecture, security, or testing decisions should be captured in documentation or decision records.

