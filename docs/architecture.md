# Architecture Notes

## Initial approach

Use a local-first architecture with Markdown files as the primary content and comment metadata stored separately until a decision record selects the final persistence format.

## Domain model

| Entity | Description |
| --- | --- |
| Document | A Markdown file under review. |
| CommentThread | A conversation attached to a document anchor. |
| Comment | A single message in a thread. |
| Anchor | A stable reference to a Markdown range or semantic block. |
| Participant | A user or agent that created or updated a comment. |

## Comment anchor strategy

Prefer layered anchors:

1. Structural position such as heading path and block index.
2. Text quote context before, inside, and after the selection.
3. Content hash for detecting drift.

This gives the system multiple signals to recover comments after edits.

## Storage direction

Evaluate these options before implementation:

| Option | Strengths | Risks |
| --- | --- | --- |
| Sidecar file, for example `document.md.comments.json` | Keeps Markdown clean, easy to parse | File pairing and rename handling |
| Workspace comment database | Efficient querying and sync | Less transparent in Git |
| Embedded HTML comments | Travels with Markdown | Can reduce readability and formatter compatibility |
| Hybrid sidecar plus optional embedded IDs | Stable anchors and clean metadata | More moving parts |

## Synchronization concerns

- Comment updates should be append-friendly when possible.
- Conflicts should preserve all user-authored content.
- Resolved threads should remain auditable unless explicitly deleted.
- Anchor repair should be deterministic and explainable.

## Security and privacy concerns

- Treat comments as potentially sensitive review data.
- Avoid storing access tokens or external service credentials in project files.
- Validate Markdown rendering paths against script injection and unsafe HTML.
- Make identity fields explicit and minimizable.

