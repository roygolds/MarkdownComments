# Architecture Notes

## First-release approach

Use a local-first VS Code extension with Markdown files as the primary content and comment metadata stored inline. The approved persistence contract is the `MarkdownComments` fenced YAML format in `docs\format.md`; sidecar files are not part of the first release.

## Extension boundaries

- Parser and indexer: find `MarkdownComments` fences, parse YAML lists, validate thread fields, and report diagnostics without rewriting malformed data.
- Comment service: map threads to VS Code comments and commands for create, reply, edit, resolve, reopen, delete, and reattach.
- Markdown writer: make minimal text edits that preserve readable source and never silently merge duplicate IDs or Git conflicts.
- Preview renderer: hide comment fences and render safe pins, cards, or highlights near the attached block or quote.

## Domain model

| Entity | Description |
| --- | --- |
| Document | A Markdown file under review. |
| CommentFence | A `MarkdownComments` fenced YAML block attached to the next Markdown block. |
| CommentThread | A conversation in a fence with a unique file-local ID and `open` or `resolved` status. |
| Comment | A single plain-text message with required author and timestamp metadata. |
| Anchor | The next Markdown block plus an optional exact `quote` inside that block. |
| Participant | A user or agent that created or updated a comment. |

## Comment anchor strategy

For the first release:

1. A fence attaches to the next Markdown block.
2. A `quote` identifies selected text inside that block; no `quote` means whole-block comment.
3. If the quote no longer matches, show the thread as needing reattach.
4. Moving a target block should move its fence with it.
5. Future anchor signals must remain explainable and compatible with the documented inline format.

## Storage direction

Inline fenced blocks are the selected first-release storage model.

- The YAML document is a list of threads with `id`, optional `status`, optional `quote`, and ordered `comments`.
- Each comment requires `by`, ISO 8601 `at`, and plain-text `text`.
- Multiple threads on the same Markdown block share one fence.
- Resolved threads remain inline by default.
- Attach around whole list items, table rows, blocks, and code fences without splitting Markdown structures.

## Synchronization concerns

- Comment updates should be append-friendly when possible.
- Conflicts should preserve all user-authored content.
- Resolved threads should remain auditable unless explicitly deleted.
- Anchor repair should be deterministic and explainable.
- Malformed YAML, duplicate IDs, and Git conflict markers should stay visible with diagnostics; tools must not auto-merge or discard them.

## Security and privacy concerns

- Treat comments as potentially sensitive review data.
- Avoid storing access tokens or external service credentials in project files.
- Render comment text as escaped plain text only.
- Validate Markdown Preview paths against script injection and unsafe HTML.
- Make display names and timestamps explicit, public in the repository, and configurable for future comments.
