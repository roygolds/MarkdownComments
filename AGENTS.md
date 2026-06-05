# Agent Instructions

This repository is intended to be friendly to AI coding agents and human contributors.

## Project context

MarkdownComments adds Microsoft Word / Google Docs style comments to Markdown files while keeping Markdown readable, portable, and version-control friendly.

Start by reading:

1. `README.md`
2. `docs\product-brief.md`
3. `docs\architecture.md`
4. `docs\squad.md`
5. `squad\agents.yml`

## Working rules

- Preserve Markdown as the source of truth unless a documented decision changes that direction.
- Prefer explicit, documented data models over hidden state.
- Keep comment metadata auditable, diffable, and safe to synchronize.
- Add tests for behavior changes once code exists.
- Update product or architecture docs when changing scope, assumptions, or core design.
- Do not commit scratchpads, secrets, local editor state, build outputs, or generated dependency folders.

## Squad workflow

- Sam coordinates execution and assigns ownership.
- Yulia owns product clarity, priorities, and acceptance criteria.
- Mark owns backend architecture and service boundaries.
- Elon owns low-level performance, synchronization, and OS concerns.
- Anna, Dor, and May implement features across C++, Python, JavaScript, and Rust.
- David reviews security, privacy, and abuse risks.
- Maya owns QA strategy, test coverage, and release confidence.

Use the squad definitions in `squad\agents.yml` as the canonical roster.

