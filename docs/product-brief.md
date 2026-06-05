# Product Brief

## Vision

Make Markdown documents support high-quality review conversations without giving up plain-text authoring, Git diffs, or portability.

## First-release goal

Ship a VS Code extension for inline Markdown comment threads using the approved `MarkdownComments` fenced YAML format in `docs\format.md`. Raw Markdown remains the source of truth; Markdown Preview should hide comment fences and render useful review UI.

## Target users

- Writers and engineers reviewing Markdown documentation.
- Product and design teams collaborating on specs.
- Open-source maintainers reviewing docs in pull requests.
- AI agents that need structured review context around Markdown changes.

## Product principles

- Keep Markdown readable, portable, auditable, and safe for Git review.
- Store comments as explicit project data, not hidden editor state.
- Preserve resolved threads inline unless a user explicitly deletes them.
- Surface anchor drift instead of silently dropping or guessing comments.

## Prioritized scope

1. Create a thread from selected text or a whole Markdown block.
2. Reply to, edit, delete, resolve, and reopen comment threads.
3. Show comments in the editor and Markdown Preview while keeping raw Markdown readable.
4. Detect a missing `quote` and show the thread as needing reattach.
5. Reattach a drifted thread by manually re-selecting a new target text or block.
6. Preserve resolved threads and readable diffs through normal Git workflows.

## User stories

- As a documentation author, I can select text or a block and start a comment thread.
- As a reviewer, I can discuss feedback through ordered replies.
- As an author, I can resolve and reopen a thread without losing its history.
- As a maintainer or AI agent, I can review comment metadata directly in Git diffs.
- As a collaborator, I can continue after nearby edits and see when a thread needs reattach.

## UX design

### VS Code editor flows

- Create from selection or current block through the command palette, context menu, or keyboard shortcut. The extension inserts a `MarkdownComments` fence before the target block, generates an ID like `mc-001` (max existing numeric suffix in the file plus one), and records required `by`, `at`, and plain-text `text` fields. `by` defaults to the local Git `user.name`, overridable by an extension setting; `at` is stored in UTC with a `Z` suffix.
- List and view threads through editor decorations, gutter indicators, folding, and a comments panel. Folded fences and badges may reduce noise, but source remains visible and auditable.
- Reply, edit, resolve, reopen, and delete by making minimal YAML edits. Comment bodies may span multiple lines as plain text. Removing the last thread from a fence removes the empty fence.
- Resolved threads are collapsed and de-emphasized by default in the editor and preview, with a toggle to show them.
- Reattach by manually selecting a new target when a quoted anchor no longer matches; the thread re-anchors to the new selection. The extension must not auto-merge duplicate IDs or Git conflict blocks, and must not propose targets automatically in the first release.
- Treat invalid YAML, duplicate IDs (including duplicates produced by a merge), and conflicted fences as visible, non-destructive states with diagnostics and read-only-safe actions. Duplicate IDs render both threads and are never renumbered or dropped silently.

### Markdown Preview

- Hide `MarkdownComments` YAML fences from rendered prose.
- Render pins, cards, or highlights near the target block or quote.
- Render comment text as escaped plain text only.

## Non-goals for the first iteration

- Replacing Markdown with a proprietary document format.
- Building realtime collaboration before the inline storage model is proven.
- Storing first-release comments in sidecar files or a workspace database.
- Supporting recursive reply trees or Markdown-formatted comment bodies.
- Assisted reattach suggestions or automatic duplicate-ID renumbering.
- Supporting every Markdown extension on day one.

## Acceptance criteria

- Supports the approved inline fenced-block format: file-unique IDs in `mc-NNN` form (next ID is the max existing numeric suffix in the file plus one), `open` and `resolved` states, optional `quote`, ordered `comments`, required `by`, required `at`, and plain-text `text`.
- Defaults `by` to the local Git `user.name` and allows overriding it through an extension setting, so creating a thread never blocks on identity.
- Stores every `at` (and any `resolvedAt`) in UTC with a `Z` suffix; the UI may render local time but stored values are UTC.
- Allows multi-line plain-text comment bodies and never renders them as Markdown.
- Supports create, list/view, reply, edit, resolve, reopen, and delete flows in VS Code.
- Detects a missing `quote` and shows the thread as needing reattach, and lets the user reattach by manually selecting a new target.
- Shows comments in Markdown Preview without rendering raw YAML fences, and collapses or de-emphasizes resolved threads by default with a toggle to show them.
- When two threads share an `id` after a merge, surfaces a duplicate-ID diagnostic, renders both threads, and never renumbers or drops either silently.
- Creating a thread adds exactly one `MarkdownComments` fence and leaves the commented block unchanged.
- Adding a reply changes only lines within that thread's fence and does not reflow surrounding Markdown.
- Never silently drops malformed, duplicate, or conflicted comment data.
- Handles whole list items, table rows, paragraphs, headings, block quotes, and code fences without breaking Markdown structure. A heading anchor targets the heading line only.

## QA focus

- Creation from selections and whole blocks, including ID generation (max suffix plus one) and `by` defaulting to Git `user.name`.
- Replies, edits, deletes, resolve, and reopen flows, including multi-line bodies and UTC `Z` timestamps.
- Invalid YAML, duplicate IDs (including duplicates produced by a merge), Git conflict markers, and non-destructive recovery rendering both threads.
- Quotes containing YAML-special characters (`:`, `#`, leading `-`, quotes, emoji, newlines) and quotes that match more than once (anchor to first occurrence).
- Malicious comment text, escaped preview rendering, and privacy-visible metadata.
- Anchor drift from edited, moved, deleted, or renamed content, plus manual reattach.
- Resolved-thread collapse/de-emphasis and the toggle to show them.
- Markdown structure preservation around lists, tables, blocks, and code fences.

## Open questions

Decided for the first release (no longer open):

- Author identity defaults to the local Git `user.name`, overridable by an extension setting.
- Reattach interaction is manual re-select of a new target.
- Duplicate IDs after a merge are surfaced only; both threads render, with no auto-renumber or drop.
- Comment bodies may be multi-line plain text.
- Timestamps are stored in UTC with a `Z` suffix.

Still needs a human decision:

- Whether to add assisted reattach suggestions in a later release.
- Whether to add assisted (opt-in) duplicate-ID renumbering in a later release.
- How to handle target blocks that are themselves fenced code blocks, and whether to give HTML `<!-- -->` comments any special handling.
