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
- **Comments sidebar**: an activity-bar view (Markdown Comments) shows just the
  comment threads for the active Markdown file — Word-style side comments — with
  the same reply/edit/resolve/reopen/delete actions. It follows whichever
  Markdown file you focus (including the interactive Comments Preview panel) and
  updates live as you edit. Click a comment to jump to its anchored line in the
  document. While the sidebar is open, the built-in Markdown preview hides its
  inline comment cards so comments appear in just one place.
- **Hide & collapse controls**: hide all comments, collapse comment bodies, hide
  resolved threads, or collapse individual threads — in the panel, the sidebar,
  and the built-in Markdown preview.

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
