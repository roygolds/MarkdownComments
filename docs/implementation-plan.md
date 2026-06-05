# Implementation Plan

This plan turns the approved format (`docs/format.md`), product brief
(`docs/product-brief.md`), and architecture notes (`docs/architecture.md`) into
an implementation-ready breakdown for the first release.

## Stack decision

The first release is a **TypeScript VS Code extension** backed by a **Rust core
compiled to WebAssembly (WASM)**.

- The Rust core owns the format contract: parsing, anchoring, validation, ID
  generation, and edit synthesis. TypeScript never parses or writes the YAML
  fence itself.
- The TypeScript extension owns UX: commands, the VS Code Comments API,
  decorations, diagnostics surfacing, the Markdown Preview plugin, and applying
  edits to the document.

## Core principles

- **Minimal-diff edits.** Every mutation produces precise text-range edits, never
  a whole-document rewrite. Untouched fences stay byte-identical.
- **Non-destructive.** Invalid YAML, duplicate IDs, and Git conflict markers are
  surfaced as diagnostics; the core never auto-merges, renumbers, or drops data.
- **Deterministic.** Same input produces the same bytes out: canonical field
  order, creation-order threads, fixed scalar-style rules.
- **Pure core.** The core is I/O-free, clock-free, and identity-free. Time (`at`,
  `resolvedAt`) and author (`by`) are inputs supplied by the extension.

## Repository layout

```
core/                              # Rust workspace (built to WASM)
├── Cargo.toml                     # [workspace]
├── rust-toolchain.toml            # pinned toolchain
├── crates/
│   ├── mdc-core/                  # pure Rust logic, natively testable
│   │   └── src/
│   │       ├── model.rs           # Document, CommentFence, Thread, Comment, Anchor
│   │       ├── parse/             # scan.rs, yaml.rs, conflict.rs
│   │       ├── anchor.rs          # next-block resolution + quote matching
│   │       ├── ids.rs             # mc-NNN parsing + next-id computation
│   │       ├── edit/              # mod.rs (TextEdit synthesis), emit.rs (YAML render)
│   │       ├── diagnostics.rs
│   │       └── text.rs            # line index + byte <-> UTF-16 mapping
│   └── mdc-wasm/                  # thin wasm-bindgen wrapper (serde glue only)
└── fuzz/                          # cargo-fuzz targets (parse, round-trip)

extension/                         # TypeScript VS Code extension
├── package.json                   # contributes: commands, menus, keybindings, settings
├── src/
│   ├── extension.ts               # activation
│   ├── core/wasmBridge.ts         # facade over the generated WASM module
│   ├── model/documentModel.ts     # version-keyed parse cache + registry
│   ├── comments/commentController.ts  # VS Code Comments API integration
│   ├── identity.ts                # author = Git user.name, overridable by setting
│   ├── decorations.ts             # gutter indicators, resolved collapse/folding
│   ├── diagnostics.ts             # surface core diagnostics
│   ├── edits.ts                   # apply core TextEdit[] via WorkspaceEdit
│   └── preview/markdownItPlugin.ts    # hides fences, renders escaped plain-text UI
├── native/mdc/                    # generated WASM artifact (built in CI, bundled, not committed)
└── test/                          # unit (mocked core) + integration (real WASM)
```

## WASM boundary contract

Stateless, synchronous, document-in / result-out. All positions are LSP-style
`{ line, character }` (0-based, UTF-16), so the extension applies them with no
conversion.

```typescript
parse(text): ParseResult                 // fences, threads, anchors, diagnostics
validate(text): Diagnostic[]             // fast on-type path
nextThreadId(text): string               // max numeric suffix + 1, e.g. "mc-007"

createThread(text, req): EditResult      // selection -> quote; caret -> whole block
addReply(text, req): EditResult
editComment(text, req): EditResult
setThreadStatus(text, req): EditResult    // resolve writes status+resolvedBy/At; reopen removes them
deleteThread(text, req): EditResult
deleteComment(text, req): EditResult
reattachThread(text, req): EditResult     // set/clear quote; move fence if target block changes
version(): string
```

- Mutation APIs return `EditResult { ok, edits: TextEdit[], newThreadId?, rejected? }`.
  The extension applies `edits` atomically as a single `vscode.WorkspaceEdit`.
- The core never returns full-document text from a mutation.
- Edits targeting an invalid-YAML or conflicted fence return `ok: false` with a
  `rejected` reason (the core will not rewrite YAML it cannot model).
- Duplicate-ID edits are disambiguated by the thread's `threadRange` from
  `ParseResult`, not by ID lookup alone.

### Key library choices

- `pulldown-cmark` — span-accurate CommonMark scanning to locate fences and the
  next block (used for structure only, never rendering).
- `serde-yaml-ng` — maintained YAML parser; safe load only (no aliases/anchors,
  no merge keys, no custom tags), with our own deterministic scalar-style emitter.
- `wasm-bindgen` + `wasm-pack --target nodejs` — synchronous load in the Node
  extension host; generated `.d.ts` is the typed boundary contract.
- TS bundling via esbuild; the Markdown Preview runs in a webview that only
  renders — the extension host parses and posts results, so we ship one WASM build.

## Milestones

### M1 — Rust core foundation
Data model, line index, byte/UTF-16 mapping, fence + block scanning, safe YAML
load, conflict detection. Native unit tests and the `docs/format.md` examples as
a fixture corpus.

### M2 — Anchoring, IDs, validation
Next-non-blank-block resolution (heading-line-only, stacked-fence skip, EOF
detached), first-occurrence quote matching, needs-reattach states, ID generation,
duplicate-ID detection, and the full diagnostics set.

### M3 — Edit synthesis + WASM boundary
Deterministic emit, all edit operations as minimal `TextEdit[]`, `wasm-bindgen`
exports, `serde-wasm-bindgen` shapes, generated typings, and `wasm-pack test`
integration tests. Round-trip and snapshot tests.

### M4 — TS extension scaffold + bridge
Extension project, esbuild build, WASM bridge wrapper, document model/cache,
diagnostics surfacing, identity resolution, and `package.json` contributions.

### M5 — Comment UX
Comments API integration and commands wired to core ops: create from selection,
create whole-block, reply, edit, resolve/reopen, delete, manual reattach. Apply
edits via `WorkspaceEdit`. Gutter decorations and resolved collapse + toggle.

### M6 — Markdown Preview integration
`markdown-it` plugin that hides `MarkdownComments` fences and renders escaped,
plain-text comment UI (Mermaid-style), including resolved de-emphasis.

### M7 — Hardening, QA, packaging
Full QA matrix (invalid YAML, duplicate IDs after merge, conflict markers,
malicious text, anchor drift, Markdown structure preservation), security review,
CI pipeline (cargo test/clippy/fmt, wasm-pack build/test, vscode-test), and `vsce`
packaging.

## Task breakdown

| ID | Task | Owner | Depends on |
| --- | --- | --- | --- |
| core-model | Rust data model + text/offset module | Elon/Anna | — |
| core-scan | Fence + block scanning (pulldown-cmark) | Anna | core-model |
| core-yaml | Safe YAML load + conflict detection | Anna | core-model |
| core-anchor | Next-block resolution + quote matching | Dor | core-scan |
| core-ids | ID parsing, generation, duplicate detection | Dor | core-yaml |
| core-diagnostics | Diagnostic types + validation pass | Dor | core-yaml, core-anchor |
| core-emit | Deterministic YAML emitter | May | core-yaml |
| core-edit | Edit synthesis (all ops) returning TextEdit[] | May | core-emit, core-anchor, core-ids |
| core-wasm | wasm-bindgen wrapper + serde shapes + typings | Elon | core-edit, core-diagnostics |
| core-tests | Unit, property, snapshot, fuzz, fixture corpus | Maya | core-edit, core-anchor |
| ext-scaffold | Extension project, esbuild, package.json contributes | Mark | core-wasm |
| ext-bridge | WASM bridge wrapper + document model/cache | Mark | core-wasm |
| ext-identity | Author identity (Git user.name + setting) | Anna | ext-scaffold |
| ext-comments | Comments API + command wiring + WorkspaceEdit apply | Dor | ext-bridge |
| ext-decorations | Gutter indicators + resolved collapse/toggle | May | ext-comments |
| ext-diagnostics | Surface core diagnostics in the editor | Anna | ext-bridge |
| ext-preview | markdown-it plugin (hide fences, escaped UI) | May | ext-bridge |
| qa-integration | vscode-test integration suite (byte-exact assertions) | Maya | ext-comments, ext-preview |
| sec-review | Security review (YAML safety, escaping, identity/privacy) | David | core-wasm, ext-preview |
| ci-packaging | CI pipeline + vsce packaging | Elon | core-tests, qa-integration |

## Testing strategy

- **Rust core (native):** unit tests per rule, `proptest` round-trip (model ->
  emit -> parse), `insta` snapshots of emitted YAML, `cargo-fuzz` for
  panic-freedom and no data loss. The `docs/format.md` examples are fixtures, so
  the format doc is executable.
- **WASM boundary:** `wasm-pack test --node` asserts serialized shapes match the
  `.d.ts` contract and edits produce expected bytes.
- **Extension:** unit tests against a mocked core; `vscode-test` integration tests
  drive create/reply/resolve/delete/reattach on fixtures and assert exact
  resulting document bytes and that surrounding Markdown is not reflowed.

## Open decisions (need confirmation before the dependent task starts)

1. **Delete-last-comment:** deleting the final comment deletes the thread (and
   empties the fence). Proposed: yes, with optional extension-side confirmation.
2. **Reattach moving the fence:** when the new target is a different block, the
   core moves the fence to precede it. Proposed: yes.
3. **`parseLight` / lazy body fetch:** only if large-document serialization cost
   is measured. Decide after benchmarking.
4. **Quote matching mode:** v1 matches literal source substrings (exact selected
   text). A CommonMark-normalized matching mode is deferred.

Already-deferred per `docs/format.md`: dedicated handling of code-fence targets
and HTML `<!-- -->` comments. The core should at least *detect* the ambiguous
code-fence case and emit an info diagnostic rather than mis-anchor.

## Risks

- **UTF-16 ↔ byte offset conversion** (emoji, CRLF, combining characters) is the
  highest-risk area; it is centralized in `text.rs` with exhaustive tests.
- **`serde_yaml` is unmaintained** — use `serde-yaml-ng` and control scalar style
  ourselves, guarded by snapshot tests.
- **Webview/core access** is routed through the host (single WASM build); revisit
  only if `postMessage` latency hurts preview UX.
- **Artifact reproducibility** — pin `wasm-bindgen`, `wasm-pack`, and `wasm-opt`
  versions; the generated `.d.ts` is part of the contract.
