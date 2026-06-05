# Product Brief

## Vision

Make Markdown documents support high-quality review conversations without giving up plain-text authoring, Git diffs, or portability.

## Target users

- Writers and engineers reviewing Markdown documentation.
- Product and design teams collaborating on specs.
- Open-source maintainers reviewing docs in pull requests.
- AI agents that need structured review context around Markdown changes.

## Core workflows

1. Select text in a Markdown document and attach a comment.
2. Reply to an existing comment thread.
3. Resolve or reopen a comment thread.
4. Move or edit nearby text without immediately losing the comment anchor.
5. Review comment metadata in a readable, version-control friendly format.

## Non-goals for the first iteration

- Replacing Markdown with a proprietary document format.
- Building a full real-time editor before the anchoring and storage model is proven.
- Supporting every Markdown extension on day one.

## Success criteria

- Comments can be created, listed, replied to, and resolved.
- Anchors remain usable after common edits near commented text.
- Stored comment data is readable, diffable, and safe to review.
- The architecture supports editor integration and future collaboration services.

## Open questions

- Should comment metadata live in sidecar files, embedded Markdown comments, front matter, or a hybrid model?
- Which editor integration should be implemented first?
- What conflict resolution strategy is best for concurrent edits?
- How much author identity should be stored locally by default?

