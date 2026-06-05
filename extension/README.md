# MarkdownComments

Microsoft Word / Google Docs style comments for Markdown files — stored inline,
readable, and Git-friendly.

Comments are kept inside the Markdown file in a fenced ` ```MarkdownComments `
block placed immediately above the block they annotate. The block holds a small
YAML list of comment threads, so review conversations travel with the text and
diff cleanly in Git.

## Features

- **Add comments** on a selection or block (Word-style threads).
- **Reply, resolve, reopen, edit, and delete** comments and threads.
- **Inline anchoring** to a quoted selection or a whole block, with a
  "needs reattach" state when a quote no longer matches.
- **Diagnostics** for invalid YAML, duplicate ids, Git conflict markers, and
  non-UTC timestamps — always non-destructive.
- **Markdown Preview integration**: comment fences render as comment cards
  (like Mermaid diagrams), never as raw code.
- **Interactive Comments Preview panel**: run *MarkdownComments: Open Comments
  Preview* (or use the editor title button) to reply, edit, resolve, reopen, and
  delete comments directly from a side-by-side preview.
- **Hide & collapse controls**: hide all comments, collapse comment bodies, hide
  resolved threads, or collapse individual threads — in both the panel and the
  built-in Markdown preview.

## How it works

A pure Rust core (compiled to WebAssembly) owns the format contract: parsing,
anchoring, validation, and deterministic edit synthesis. The extension supplies
identity (Git `user.name`) and timestamps, applies the text edits the core
returns, and renders the VS Code Comments UI.

## Settings

- `markdownComments.authorName`: display name for new comments (defaults to the
  local Git `user.name`).
- `markdownComments.showResolved`: show resolved threads inline.

## Format

See [`docs/format.md`](../docs/format.md) for the full format specification.

## License

MIT — see [LICENSE](./LICENSE).
