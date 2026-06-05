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
5. Preserve resolved threads and readable diffs through normal Git workflows.

## User stories

- As a documentation author, I can select text or a block and start a comment thread.
- As a reviewer, I can discuss feedback through ordered replies.
- As an author, I can resolve and reopen a thread without losing its history.
- As a maintainer or AI agent, I can review comment metadata directly in Git diffs.
- As a collaborator, I can continue after nearby edits and see when a thread needs reattach.

## UX design

### VS Code editor flows

- Create from selection or current block through the command palette, context menu, or keyboard shortcut. The extension inserts a `MarkdownComments` fence before the target block, generates an ID like `mc-001`, and records required `by`, `at`, and plain-text `text` fields.
- List and view threads through editor decorations, gutter indicators, folding, and a comments panel. Folded fences and badges may reduce noise, but source remains visible and auditable.
- Reply, edit, resolve, reopen, and delete by making minimal YAML edits. Removing the last thread from a fence removes the empty fence.
- Reattach by selecting a new target when a quoted anchor no longer matches. The extension must not auto-merge duplicate IDs or Git conflict blocks.
- Treat invalid YAML, duplicate IDs, and conflicted fences as visible, non-destructive states with diagnostics and read-only-safe actions.

### Markdown Preview

- Hide `MarkdownComments` YAML fences from rendered prose.
- Render pins, cards, or highlights near the target block or quote.
- Render comment text as escaped plain text only.

## Non-goals for the first iteration

- Replacing Markdown with a proprietary document format.
- Building realtime collaboration before the inline storage model is proven.
- Storing first-release comments in sidecar files or a workspace database.
- Supporting recursive reply trees or Markdown-formatted comment bodies.
- Supporting every Markdown extension on day one.

## Acceptance criteria

- Supports the approved inline fenced-block format: unique IDs such as `mc-001`, `open` and `resolved` states, optional `quote`, ordered `comments`, required `by`, required ISO 8601 `at`, and plain-text `text`.
- Supports create, list/view, reply, edit, resolve, reopen, delete, and reattach flows in VS Code.
- Shows comments in Markdown Preview without rendering raw YAML fences.
- Surfaces missing quotes as needing reattach and preserves resolved threads inline.
- Keeps comment diffs readable and never silently drops malformed, duplicate, or conflicted comment data.
- Handles whole list items, table rows, paragraphs, headings, block quotes, and code fences without breaking Markdown structure.

## QA focus

- Creation from selections and whole blocks.
- Replies, edits, deletes, resolve, and reopen flows.
- Invalid YAML, duplicate IDs, Git conflict markers, and non-destructive recovery.
- Malicious comment text, escaped preview rendering, and privacy-visible metadata.
- Anchor drift from edited, moved, deleted, or renamed content.
- Markdown structure preservation around lists, tables, blocks, and code fences.

## Open questions

- What exact reattach interaction is best for drifted or moved targets?
- What display-name and timestamp defaults should be configurable for future comments?
