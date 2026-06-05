# MarkdownComments Format

## Phase 1 decision

MarkdownComments uses inline fenced blocks for the first release.

Each comment block is a Markdown fenced code block with the info string
`MarkdownComments`. The block contains YAML and appears immediately before the
Markdown block it comments on.

The first release prioritizes a simple, readable, Git-friendly format:

- Comments are stored inline in the Markdown file.
- Comment text is plain text and may span multiple lines. It is never rendered
  as Markdown in the first release.
- Each comment includes a timestamp by default, stored in UTC with a `Z` suffix.
- Resolved comments remain inline.
- IDs are user-friendly and unique within the Markdown file, such as `mc-001`.
- The author display name defaults to the local Git `user.name` and can be
  overridden by a VS Code extension setting.
- If a quoted anchor no longer matches, the extension surfaces the thread as
  needing reattach; the user re-targets by manually selecting new text or a
  block.

## Canonical shape

````markdown
```MarkdownComments
- id: mc-001
  status: open
  quote: "selected text"
  comments:
    - by: Reviewer Name
      at: "2026-06-05T08:03:51Z"
      text: Plain text comment.
```
Markdown content being commented on.
````

## YAML schema

The YAML document is a list of comment threads. Threads are kept in creation
order, oldest first.

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | User-friendly thread ID unique within the Markdown file (canonical form `mc-NNN`, e.g. `mc-001`). |
| `status` | No | `open` or `resolved`. Defaults to `open`. |
| `quote` | No | Exact selected text inside the next Markdown block, stored as a YAML string. Omit for whole-block comments. |
| `resolvedBy` | No | Display name of whoever resolved the thread. Optional, set when `status: resolved`. |
| `resolvedAt` | No | UTC ISO 8601 timestamp (`Z` suffix) when the thread was resolved. Optional, set when `status: resolved`. |
| `comments` | Yes | Ordered list of comments in the thread, oldest first. |
| `comments[].by` | Yes | Display name of the commenter. Defaults to the local Git `user.name`. |
| `comments[].at` | Yes | UTC ISO 8601 timestamp with a `Z` suffix, e.g. `2026-06-05T08:03:51Z`. |
| `comments[].text` | Yes | Plain text comment body. May span multiple lines using a YAML block scalar. |

### ID generation

- IDs are generated at create time and are scoped per Markdown file.
- A new ID takes the maximum existing numeric suffix in that file plus one. The
  first comment in a file is `mc-001`.
- The numeric suffix is parsed from the canonical `mc-NNN` form; the `mc` prefix
  and hyphen are consistent across all documents and examples.
- IDs remain stable after creation. The extension never renumbers an existing
  thread.

### Identity and timestamps

- `by` defaults to the local Git `user.name`, overridable by a VS Code extension
  setting, so the create flow can run without prompting.
- `at`, `resolvedAt`, and any other stored timestamps are written in UTC with a
  `Z` suffix. The UI may render local time, but stored values are always UTC.

### Duplicate IDs after a merge

A Git merge can produce two threads with the same `id` in one file. This is a
non-destructive diagnostic state:

- The extension surfaces a duplicate-ID diagnostic.
- Both threads are rendered; neither is hidden.
- The extension never renumbers or drops a thread silently to "fix" the
  collision. Resolving the duplicate is a manual, user-driven action.

## Examples

### Single comment

````markdown
```MarkdownComments
- id: mc-001
  quote: "version-control friendly"
  comments:
    - by: Yulia
      at: "2026-06-05T08:03:51Z"
      text: Make this promise more concrete.
```
MarkdownComments keeps Markdown readable and version-control friendly.
````

### Multi-line comment body

Comment bodies may span multiple lines. Use a YAML block scalar (`|-`) so the
text stays readable and stable in diffs. The body is plain text, not Markdown.

````markdown
```MarkdownComments
- id: mc-002
  quote: "Git sync"
  comments:
    - by: Mark
      at: "2026-06-05T08:04:00Z"
      text: |-
        Two questions here:
        Does this cover rebases as well as merges?
        And what happens to resolved threads?
```
Support Git sync for Markdown review workflows.
````

### Comment thread with replies

Replies are additional entries in the `comments` list, ordered from oldest to
newest.

````markdown
```MarkdownComments
- id: mc-003
  quote: "review threads"
  comments:
    - by: Mark
      at: "2026-06-05T08:04:30Z"
      text: Does this mean normal commits and merges?
    - by: Elon
      at: "2026-06-05T08:05:00Z"
      text: Yes. No realtime collaboration in Phase 1.
```
Support Git-based review threads for Markdown workflows.
````

### Resolved comment

Resolved comments remain inline in the Markdown file. Resolution may be recorded
with the optional `resolvedBy` and `resolvedAt` (UTC) fields.

````markdown
```MarkdownComments
- id: mc-004
  status: resolved
  resolvedBy: Sam
  resolvedAt: "2026-06-05T08:08:30Z"
  comments:
    - by: Maya
      at: "2026-06-05T08:06:00Z"
      text: Add an acceptance criterion here.
    - by: Sam
      at: "2026-06-05T08:08:00Z"
      text: Added below.
```
Comments can be created, replied to, and resolved.
````

### Multiple comments on the same Markdown block

Multiple threads for the same Markdown block are stored in the same
`MarkdownComments` fence.

````markdown
```MarkdownComments
- id: mc-005
  quote: "VS Code extension"
  comments:
    - by: Anna
      at: "2026-06-05T08:09:00Z"
      text: Good first integration target.
- id: mc-006
  quote: "Markdown Preview"
  comments:
    - by: Dor
      at: "2026-06-05T08:10:00Z"
      text: Render like Mermaid, but safely.
```
First implementation targets a VS Code extension with Markdown Preview integration.
````

## Anchoring rules

1. A `MarkdownComments` fence attaches to the next Markdown block.
2. If `quote` is present, it identifies the selected text inside that block.
3. If `quote` is absent, the comment applies to the whole block.
4. When moving the target block, move its comment fence with it.
5. If `quote` no longer exists in the target block, the extension surfaces the
   thread as needing reattach.
6. Multi-block selections are out of scope for the first release.

### What "next Markdown block" means

- The target is the next non-blank Markdown block element after the closing
  fence. Blank lines between the fence and the target are ignored.
- A heading target anchors the heading line only, not the whole section beneath
  it.
- If two `MarkdownComments` fences stack, each binds to the next non-comment
  block; a comment fence is never the target of another comment fence.
- A fence with no following block (for example, at the end of the file) is a
  detached thread and is surfaced as needing reattach.

### Quote matching

- `quote` is the exact selected text, stored as a YAML string. It MUST be
  quoted and escaped correctly. Use a YAML block scalar for multi-line
  selections.
- If `quote` matches more than once inside the target block, the thread anchors
  to the first occurrence.
- Quotes containing YAML-special characters (`:`, `#`, leading `-`, quotes,
  emoji, or newlines) must round-trip without changing meaning. QA must cover
  these cases explicitly.

### Reattach interaction

- For the first release, reattach is manual: the user selects new text or a
  block and the thread re-anchors to that selection.
- Assisted reattach suggestions (proposing a likely new target automatically)
  are an explicitly deferred non-goal.

### Code-fence targets and HTML comments

Handling of these two cases is deferred and remains open for a future release:

- Commenting on a target block that is itself a fenced code block (where the
  `MarkdownComments` fence and the target fence could be ambiguous, for example
  needing a longer outer fence or tildes `~~~`).
- Special handling of HTML `<!-- -->` comments.

The first release does not define dedicated behavior for either case.

## Editing, resolving, deleting, and syncing

- Add a reply by appending a new item to `comments`. Comments stay in creation
  order, oldest first.
- Resolve a thread by setting `status: resolved`, optionally recording
  `resolvedBy` and `resolvedAt` (UTC).
- Reopen a thread by setting `status: open`.
- Edit a comment by changing its `text`.
- Keep resolved threads inline by default.
- Delete a thread by removing it from the YAML list. Remove the whole fence if
  it becomes empty.
- Within a file and within a shared fence, threads are kept in creation order,
  oldest first.
- Sync through normal Git commits and merges.
- Merge tools and extensions must not silently drop comment blocks or threads.
- Thread IDs should remain stable after creation.
- The audit trail for the first release is the Git history of the Markdown file.
  An in-document revision history is out of scope.

## Inline blocks versus sidecar files

Inline fenced blocks are the Phase 1 storage format.

| Approach | Pros | Cons |
| --- | --- | --- |
| Inline fenced blocks | Simple, portable, visible in Git, and travels with the commented text. | Adds visible noise to raw Markdown and can create nearby merge conflicts. |
| Sidecar files | Keeps Markdown clean and makes metadata easier to expand later. | Adds pairing and rename complexity, and comments are easier to miss in review. |

Sidecar files are not part of the first release format.

## Out of scope for the first release

- Recursive reply trees.
- Markdown-formatted comment bodies (bodies are plain text, multi-line allowed).
- Sidecar metadata files.
- Multi-block comment anchors.
- Assisted reattach suggestions and automatic duplicate-ID renumbering.
- Hidden IDs, hashes, event logs, or in-document revision history.
