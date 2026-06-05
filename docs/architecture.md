# Architecture Notes

## First-release approach

Use a local-first VS Code extension with Markdown files as the primary content and comment metadata stored inline. The approved persistence contract is the `MarkdownComments` fenced YAML format in `docs\format.md`; sidecar files are not part of the first release.

## Extension boundaries

- Parser and indexer: find `MarkdownComments` fences, parse YAML lists, validate thread fields, and report diagnostics without rewriting malformed data.
- Comment service: map threads to VS Code comments and commands for create, reply, edit, resolve, reopen, delete, and manual reattach. New IDs use the max existing numeric suffix in the file plus one; `by` defaults to the local Git `user.name`.
- Markdown writer: make minimal text edits that preserve readable source and never silently merge duplicate IDs or Git conflicts. Stored timestamps are UTC with a `Z` suffix.
- Preview renderer: hide comment fences and render safe pins, cards, or highlights near the attached block or quote.
- Interactive comments preview panel: a dedicated webview (separate from VS Code's built-in Markdown preview) that renders the document plus interactive comment cards and lets the user reply, edit, resolve, reopen, delete, hide, and collapse comments. It is required because the built-in Markdown preview exposes no supported channel to write edits back to the extension; built-in preview support is therefore limited to read-only cards plus hide/collapse affordances.

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

### Identity trust model

- `by`, `at`, `resolvedBy`, and `resolvedAt` are **advisory display metadata, not authenticated identity**. They are plain text written by the local extension and committed verbatim, so anyone with write access can hand-edit a file to attribute, backdate, or deny a comment.
- The authoritative audit trail is the **Git history** of the Markdown file (commit author, `git blame`, and — where enabled — signed commits). In-document signatures, hashes, or event logs are out of scope.
- The OS account name is never used as an author fallback (to avoid leaking the local username into shared files); when no setting and no Git `user.name` are available the author is recorded as `Unknown`.

### Preview panel webview hardening

- The interactive preview panel renders Markdown with `html: false` and a strict Content-Security-Policy: `default-src 'none'`, nonce-gated `script-src` (no `unsafe-inline`/`eval`), and `localResourceRoots` scoped to the extension's `media/` folder. The nonce is generated with a cryptographic RNG.
- All document-derived content (comment text, author, timestamp, thread id, quote, and any invalid raw payload) is HTML-escaped before being placed in element text or attributes, and is never interpolated into JavaScript. The webview script only reads `data-` attributes and element text and assigns user input to `textarea.value`.
- Every inbound webview message is validated as hostile (known type, bounded string lengths, integer indices) and guarded by both the document `uri` and `docVersion`; the version is re-checked after every `await` so a concurrent external edit cannot make a positional edit land on the wrong range. Operations are serialized and `deleteThread` requires a modal confirmation. The Rust/WASM core remains the authority and rejects ambiguous edits.
- Accepted residuals: the panel allows remote (`https:`/`data:`) images in the rendered Markdown body, matching VS Code's own preview behavior (a malicious document could beacon on open); and raw HTML elsewhere in the document may still render in VS Code's **built-in** preview, which controls its own markdown-it `html` setting — the extension's comment cards remain escaped regardless.

### Parser hardening

- The YAML reader rejects payloads larger than a fixed size cap (1 MiB) and relies on libyaml's repetition limit to reject alias/anchor "billion laughs" bombs, so parsing untrusted documents on every keystroke stays bounded.
- Git conflict regions — including an unterminated `<<<<<<<` with no closing marker — are detected and surfaced as diagnostics; overlapping fences are never parsed or auto-merged, and edits to them are rejected.

