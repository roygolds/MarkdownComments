# Change Log

All notable changes to the **MarkdownComments** extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Interactive **Comments Preview** panel (command:
  `MarkdownComments: Open Comments Preview`, also available from the editor
  title bar). The panel renders the Markdown alongside comment cards and lets
  you reply, edit, resolve, reopen, and delete comments directly from the
  preview, applying changes back to the document.
- **Comments sidebar** (activity-bar view "Markdown Comments") that shows only
  the comment threads for the active Markdown file — Word-style side comments —
  with the same reply/edit/resolve/reopen/delete actions. It follows the active
  Markdown editor (and the interactive Comments Preview panel) and updates live
  as the document changes. Clicking a comment focuses it: when the interactive
  Comments Preview panel is open for that file, the panel is brought forward,
  scrolled to the thread, and the thread is briefly highlighted; when you're in
  VS Code's built-in Markdown preview, the commented line is revealed through
  editor/preview scroll-sync so the preview follows without switching you to the
  raw text; otherwise the source Markdown is revealed at the anchored line. While
  the sidebar is open the built-in Markdown preview hides its inline comment cards
  (re-rendered live via `markdown.preview.refresh`) to avoid showing comments
  twice.
- Hide and collapse controls for comments in the panel, the sidebar, and
  VS Code's built-in Markdown preview: hide all comments, collapse all comment
  bodies, hide resolved threads, and collapse individual threads.
- **Timestamped build versions**: `npm run package` stamps the version as
  `X.Y.Z-YYYYMMDD-HHMMSS` (then restores the clean base version in
  `package.json`), so each `.vsix` is uniquely identifiable and you can tell
  which build is installed. Helper scripts: `version:stamp`,
  `version:stamp:write`, and `version:reset`. A shared `F5` launch config
  (`Run MarkdownComments Extension`) rebuilds the bundle before launching.

### Fixed

- Clicking a sidebar comment now reliably scrolls VS Code's built-in Markdown
  preview to the anchored line. The reveal waits for the editor's visible range
  to actually change and nudges the editor when the target is already at the top,
  guaranteeing the visible-range event the preview's scroll-sync depends on
  fires. When only the preview is open (no visible source editor), the source is
  opened beside it — the only way VS Code lets an extension drive the built-in
  preview — without taking keyboard focus away from the comments.

### Security

- The preview panel and sidebar render Markdown with `html:false` and a strict
  Content-Security-Policy (nonce-gated scripts, no inline/eval). All
  document-derived content is HTML-escaped and never passed into JavaScript;
  inbound webview messages are validated and guarded by a uri + document-version
  check (re-checked after every async step) before any edit is applied.

## [0.1.0] - 2026-06-05

Initial release.

### Added

- Microsoft Word / Google Docs–style comments stored as inline
  ` ```MarkdownComments ` fenced YAML blocks, keeping Markdown readable and
  Git-friendly.
- Comment lifecycle in VS Code via the native Comments API: create, reply, edit,
  resolve, reopen, and delete.
- Stable anchoring of comments to the following Markdown block, with an optional
  `quote` for sub-block precision and a manual reattach flow when an anchor
  drifts.
- Markdown Preview integration (à la Mermaid) that renders comment threads as
  cards with HTML-escaped content.
- Diagnostics for invalid YAML, Git conflict markers, duplicate ids,
  non-canonical ids, non-UTC timestamps, and anchors needing reattachment.
- Author identity resolved from the `markdownComments.authorName` setting or the
  local Git `user.name`; timestamps recorded in UTC.
- Rust core compiled to WebAssembly for parsing, validation, and deterministic
  edit synthesis.
