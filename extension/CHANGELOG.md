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
- Hide and collapse controls for comments in both the new panel and VS Code's
  built-in Markdown preview: hide all comments, collapse all comment bodies,
  hide resolved threads, and collapse individual threads.

### Security

- The preview panel renders Markdown with `html:false` and a strict
  Content-Security-Policy (nonce-gated scripts, no inline/eval). All
  document-derived content is HTML-escaped and never passed into JavaScript;
  inbound webview messages are validated and guarded by a document-version
  check before any edit is applied.

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
