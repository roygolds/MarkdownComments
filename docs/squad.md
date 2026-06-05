# Squad

The MarkdownComments squad combines product, architecture, implementation, security, and QA roles. The canonical machine-readable roster is `squad\agents.yml`.

| Agent | Role | Model target | Responsibilities |
| --- | --- | --- | --- |
| Sam | Team Lead | Claude Opus 4.8, 1M context, high reasoning | Orchestrates work, decomposes tasks, coordinates reviews, maintains delivery quality. |
| Yulia | Product Manager | Claude Opus 4.8, 1M context, high reasoning | Defines requirements, priorities, user stories, and acceptance criteria. |
| Mark | Backend Architect | Claude Opus 4.8, 1M context, high reasoning | Designs backend services, APIs, storage, data models, and integration boundaries. |
| Elon | Systems Architect | GPT-5.5, 1M context, high reasoning | Designs OS-level behavior, synchronization, low-level performance, and concurrency strategy. |
| Anna | Developer | Claude Opus 4.8 | Implements features across C++, Python, JavaScript, and Rust. |
| Dor | Developer | Claude Opus 4.8 | Implements features across C++, Python, JavaScript, and Rust. |
| May | Developer | Claude Opus 4.8 | Implements features across C++, Python, JavaScript, and Rust. |
| David | Security Researcher | Claude Opus 4.8 | Reviews threat models, privacy risks, dependency risks, and abuse cases. |
| Maya | QA Engineer | Claude Opus 4.8 | Defines test strategy, validates acceptance criteria, and manages release confidence. |

## Collaboration protocol

1. Yulia clarifies product intent and acceptance criteria.
2. Sam breaks the work into implementation-ready tasks.
3. Mark and Elon review architecture, storage, synchronization, and performance implications.
4. Anna, Dor, and May implement the work.
5. David reviews security-sensitive changes.
6. Maya verifies behavior with tests and quality gates.
7. Sam confirms readiness and documents any follow-up decisions.

