# Change Log

All notable changes to the **MarkdownComments** extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
