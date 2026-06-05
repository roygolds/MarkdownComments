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
  updates live as you edit. Click a comment to jump to it: if our interactive
  Comments Preview panel is open for that file, the panel scrolls to the thread
  and briefly highlights it; if you're in VS Code's built-in Markdown preview,
  the commented line is revealed via scroll-sync (the preview follows along
  without yanking you to the raw text); otherwise the source Markdown opens at
  the anchored line. While the sidebar is open, the built-in Markdown preview
  hides its inline comment cards so comments appear in just one place.
- **Hide & collapse controls**: hide all comments, collapse comment bodies, hide
  resolved threads, or collapse individual threads — in the panel, the sidebar,
  and the built-in Markdown preview.

## How it works

A pure Rust core (compiled to WebAssembly) owns the format contract: parsing,
anchoring, validation, and deterministic edit synthesis. The extension supplies
identity (Git `user.name`) and timestamps, applies the text edits the core
returns, and renders the VS Code Comments UI.

## Running the extension (development)

Press <kbd>F5</kbd> in VS Code (open either the repository root or the `extension`
folder). The bundled **Run MarkdownComments Extension** launch config runs a
`build extension` task first, so the Extension Development Host always starts from
a freshly built `dist/`. Then open a `.md` file in the new window.

> [!IMPORTANT]
> After changing extension code you must reload the running window for the change
> to take effect: in the Extension Development Host run **Developer: Reload Window**
> (<kbd>Ctrl</kbd>+<kbd>R</kbd>), or stop and press <kbd>F5</kbd> again. If you
> instead installed a packaged `.vsix`, reinstall the new build — an old install
> keeps running stale code. `dist/` is git-ignored, so a fresh clone has no build
> until you run `npm run build` (F5 does this for you).

### Built-in preview vs. Comments Preview panel

Clicking a comment in the sidebar focuses it best in the **Comments Preview
panel** (*MarkdownComments: Open Comments Preview*), which the extension fully
controls — it scrolls to and highlights the thread. VS Code's **built-in**
Markdown preview cannot be scrolled to a line by any extension API; the sidebar
falls back to editor→preview scroll-sync, which only moves the built-in preview
when a source editor for the file is visible and
`markdown.preview.scrollPreviewWithEditor` is enabled (the default). With only
the built-in preview open and no visible editor, the click opens the source
editor beside the preview instead.

## Settings

- `markdownComments.authorName`: display name for new comments (defaults to the
  local Git `user.name`).
- `markdownComments.showResolved`: show resolved threads inline.

## Format

See [`docs/format.md`](../docs/format.md) for the full format specification.

## License

MIT — see [LICENSE](./LICENSE).
