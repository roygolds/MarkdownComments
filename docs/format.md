# MarkdownComments Format

## Phase 1 decision

MarkdownComments uses inline fenced blocks for the first release.

Each comment block is a Markdown fenced code block with the info string
`MarkdownComments`. The block contains YAML and appears immediately before the
Markdown block it comments on.

The first release prioritizes a simple, readable, Git-friendly format:

- Comments are stored inline in the Markdown file.
- Comment text is plain text.
- Each comment includes a timestamp by default.
- Resolved comments remain inline.
- IDs are user-friendly and unique within the Markdown file, such as `mc-001`.
- If a quoted anchor no longer matches, the extension should show the thread as
  needing reattach.

## Canonical shape

````markdown
```MarkdownComments
- id: mc-001
  status: open
  quote: "selected text"
  comments:
    - by: Reviewer Name
      at: "2026-06-05T11:03:51+03:00"
      text: Plain text comment.
```
Markdown content being commented on.
````

## YAML schema

The YAML document is a list of comment threads.

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | User-friendly thread ID unique within the Markdown file. |
| `status` | No | `open` or `resolved`. Defaults to `open`. |
| `quote` | No | Exact selected text inside the next Markdown block. Omit for whole-block comments. |
| `comments` | Yes | Ordered list of comments in the thread. |
| `comments[].by` | Yes | Display name of the commenter. |
| `comments[].at` | Yes | ISO 8601 timestamp for the comment. |
| `comments[].text` | Yes | Plain text comment body. |

## Examples

### Single comment

````markdown
```MarkdownComments
- id: mc-001
  quote: "version-control friendly"
  comments:
    - by: Yulia
      at: "2026-06-05T11:03:51+03:00"
      text: Make this promise more concrete.
```
MarkdownComments keeps Markdown readable and version-control friendly.
````

### Comment thread with replies

Replies are additional entries in the `comments` list, ordered from oldest to
newest.

````markdown
```MarkdownComments
- id: mc-002
  quote: "Git sync"
  comments:
    - by: Mark
      at: "2026-06-05T11:04:00+03:00"
      text: Does this mean normal commits and merges?
    - by: Elon
      at: "2026-06-05T11:05:00+03:00"
      text: Yes. No realtime collaboration in Phase 1.
```
Support Git sync for Markdown review workflows.
````

### Resolved comment

Resolved comments remain inline in the Markdown file.

````markdown
```MarkdownComments
- id: mc-003
  status: resolved
  comments:
    - by: Maya
      at: "2026-06-05T11:06:00+03:00"
      text: Add an acceptance criterion here.
    - by: Sam
      at: "2026-06-05T11:08:00+03:00"
      text: Added below.
```
Comments can be created, replied to, and resolved.
````

### Multiple comments on the same Markdown block

Multiple threads for the same Markdown block are stored in the same
`MarkdownComments` fence.

````markdown
```MarkdownComments
- id: mc-004
  quote: "VS Code extension"
  comments:
    - by: Anna
      at: "2026-06-05T11:09:00+03:00"
      text: Good first integration target.
- id: mc-005
  quote: "Markdown Preview"
  comments:
    - by: Dor
      at: "2026-06-05T11:10:00+03:00"
      text: Render like Mermaid, but safely.
```
First implementation targets a VS Code extension with Markdown Preview integration.
````

## Anchoring rules

1. A `MarkdownComments` fence attaches to the next Markdown block.
2. If `quote` is present, it identifies the selected text inside that block.
3. If `quote` is absent, the comment applies to the whole block.
4. When moving the target block, move its comment fence with it.
5. If `quote` no longer exists in the target block, the extension should show
   the thread as needing reattach.
6. Multi-block selections are out of scope for the first release.

## Editing, resolving, deleting, and syncing

- Add a reply by appending a new item to `comments`.
- Resolve a thread by setting `status: resolved`.
- Reopen a thread by setting `status: open`.
- Edit a comment by changing its `text`.
- Keep resolved threads inline by default.
- Delete a thread by removing it from the YAML list. Remove the whole fence if
  it becomes empty.
- Sync through normal Git commits and merges.
- Merge tools and extensions must not silently drop comment blocks or threads.
- Thread IDs should remain stable after creation.

## Inline blocks versus sidecar files

Inline fenced blocks are the Phase 1 storage format.

| Approach | Pros | Cons |
| --- | --- | --- |
| Inline fenced blocks | Simple, portable, visible in Git, and travels with the commented text. | Adds visible noise to raw Markdown and can create nearby merge conflicts. |
| Sidecar files | Keeps Markdown clean and makes metadata easier to expand later. | Adds pairing and rename complexity, and comments are easier to miss in review. |

Sidecar files are not part of the first release format.

## Out of scope for the first release

- Recursive reply trees.
- Markdown-formatted comment bodies.
- Sidecar metadata files.
- Multi-block comment anchors.
- Hidden IDs, hashes, event logs, or revision history.
