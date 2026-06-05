# Architecture Notes

## First-release approach

Use a local-first VS Code extension with Markdown files as the primary content and comment metadata stored inline. The approved persistence contract is the `MarkdownComments` fenced YAML format in `docs\format.md`; sidecar files are not part of the first release.

## Extension boundaries

- Parser and indexer: find `MarkdownComments` fences, parse YAML lists, validate thread fields, and report diagnostics without rewriting malformed data.
- Comment service: map threads to VS Code comments and commands for create, reply, edit, resolve, reopen, delete, and manual reattach. New IDs use the max existing numeric suffix in the file plus one; `by` defaults to the local Git `user.name`.
- Markdown writer: make minimal text edits that preserve readable source and never silently merge duplicate IDs or Git conflicts. Stored timestamps are UTC with a `Z` suffix.
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

1. A fence attaches to the next non-blank Markdown block after its closing fence. A heading target anchors the heading line only.
2. A `quote` identifies selected text inside that block; no `quote` means whole-block comment. If a quote matches more than once, it anchors to the first occurrence.
3. If the quote no longer matches, show the thread as needing reattach. Reattach is manual: the user selects a new target and the thread re-anchors.
4. Moving a target block should move its fence with it.
5. Future anchor signals must remain explainable and compatible with the documented inline format. Assisted reattach suggestions are deferred.

## Storage direction

Inline fenced blocks are the selected first-release storage model.

- The YAML document is a list of threads with `id`, optional `status`, optional `quote`, optional `resolvedBy`/`resolvedAt`, and ordered `comments`. Threads and comments are kept in creation order, oldest first.
- Each comment requires `by`, a UTC ISO 8601 `at` with a `Z` suffix, and plain-text `text`. Comment bodies may span multiple lines.
- Multiple threads on the same Markdown block share one fence.
- Resolved threads remain inline by default and are collapsed or de-emphasized in the UI.
- Attach around whole list items, table rows, blocks, and code fences without splitting Markdown structures. Dedicated handling of code-fence targets and HTML `<!-- -->` comments is deferred and open for a future release.

## Synchronization concerns

- Comment updates should be append-friendly when possible.
- Conflicts should preserve all user-authored content.
- Resolved threads should remain auditable unless explicitly deleted. The audit trail is the Git history of the Markdown file; in-document revision history is out of scope.
- Anchor repair is manual and deterministic: the user re-selects a target and the thread re-anchors.
- Malformed YAML, duplicate IDs, and Git conflict markers should stay visible with diagnostics; tools must not auto-merge or discard them. Duplicate IDs after a merge render both threads and are never renumbered or dropped silently.

## Security and privacy concerns

- Treat comments as potentially sensitive review data.
- Avoid storing access tokens or external service credentials in project files.
- Render comment text as escaped plain text only.
- Validate Markdown Preview paths against script injection and unsafe HTML.
- Make display names and timestamps explicit and public in the repository. `by` defaults to the local Git `user.name`, overridable by an extension setting; timestamps are stored in UTC.
