//! Integration tests that exercise the canonical examples from
//! `docs/format.md`: parsing, anchoring, deterministic emit, and round-trips.

use mdc_core::edit::{apply_edits, EditResult};
use mdc_core::emit::emit_fence;
use mdc_core::model::Status;
use mdc_core::{parse_document, ParsedDocument};

fn threads(doc: &ParsedDocument) -> Vec<mdc_core::model::Thread> {
    doc.fences
        .iter()
        .flat_map(|f| f.threads.iter().map(|t| t.thread.clone()))
        .collect()
}

/// Parsing then re-emitting every fence must round-trip the model exactly, and
/// be idempotent at the byte level on a second emit.
fn assert_roundtrips(src: &str) {
    let doc = parse_document(src);
    assert!(
        doc.diagnostics
            .iter()
            .all(|d| d.code != mdc_core::diagnostics::DiagnosticCode::InvalidYaml),
        "unexpected invalid-yaml diagnostic for: {src}"
    );

    // Re-emit each fence in place and re-parse; models must match.
    let mut edits = Vec::new();
    for fence in &doc.fences {
        let ts: Vec<_> = fence.threads.iter().map(|t| t.thread.clone()).collect();
        let text = emit_fence(&ts, fence.fence_char, fence.fence_len, "\n");
        edits.push(mdc_core::edit::TextEdit {
            start: fence.block_start,
            end: fence.block_end,
            new_text: text,
        });
    }
    let reemitted = apply_edits(src, &edits);
    let doc2 = parse_document(&reemitted);
    assert_eq!(
        threads(&doc),
        threads(&doc2),
        "model changed after re-emit for: {src}"
    );

    // Second emit must be byte-identical (determinism / idempotency).
    let mut edits2 = Vec::new();
    for fence in &doc2.fences {
        let ts: Vec<_> = fence.threads.iter().map(|t| t.thread.clone()).collect();
        let text = emit_fence(&ts, fence.fence_char, fence.fence_len, "\n");
        edits2.push(mdc_core::edit::TextEdit {
            start: fence.block_start,
            end: fence.block_end,
            new_text: text,
        });
    }
    let reemitted2 = apply_edits(&reemitted, &edits2);
    assert_eq!(reemitted, reemitted2, "emit not idempotent for: {src}");
}

#[test]
fn single_comment_example() {
    let src = "```MarkdownComments\n- id: mc-001\n  quote: \"version-control friendly\"\n  comments:\n    - by: Yulia\n      at: \"2026-06-05T08:03:51Z\"\n      text: Make this promise more concrete.\n```\nMarkdownComments keeps Markdown readable and version-control friendly.\n";
    let doc = parse_document(src);
    assert_eq!(doc.fences.len(), 1);
    assert_eq!(doc.fences[0].threads.len(), 1);
    assert_eq!(doc.fences[0].threads[0].thread.comments.len(), 1);
    assert_roundtrips(src);
}

#[test]
fn multiline_body_example() {
    let src = "```MarkdownComments\n- id: mc-002\n  quote: \"Git sync\"\n  comments:\n    - by: Mark\n      at: \"2026-06-05T08:04:00Z\"\n      text: |-\n        Two questions here:\n        Does this cover rebases as well as merges?\n        And what happens to resolved threads?\n```\nSupport Git sync for Markdown review workflows.\n";
    let doc = parse_document(src);
    let body = &doc.fences[0].threads[0].thread.comments[0].text;
    assert!(body.contains('\n'));
    assert!(body.starts_with("Two questions here:"));
    assert_roundtrips(src);
}

#[test]
fn thread_with_replies_example() {
    let src = "```MarkdownComments\n- id: mc-003\n  quote: \"review threads\"\n  comments:\n    - by: Mark\n      at: \"2026-06-05T08:04:30Z\"\n      text: Does this mean normal commits and merges?\n    - by: Elon\n      at: \"2026-06-05T08:05:00Z\"\n      text: Yes. No realtime collaboration in Phase 1.\n```\nSupport Git-based review threads for Markdown workflows.\n";
    let doc = parse_document(src);
    assert_eq!(doc.fences[0].threads[0].thread.comments.len(), 2);
    assert_roundtrips(src);
}

#[test]
fn resolved_comment_example() {
    let src = "```MarkdownComments\n- id: mc-004\n  status: resolved\n  resolvedBy: Sam\n  resolvedAt: \"2026-06-05T08:08:30Z\"\n  comments:\n    - by: Maya\n      at: \"2026-06-05T08:06:00Z\"\n      text: Add an acceptance criterion here.\n    - by: Sam\n      at: \"2026-06-05T08:08:00Z\"\n      text: Added below.\n```\nComments can be created, replied to, and resolved.\n";
    let doc = parse_document(src);
    let t = &doc.fences[0].threads[0].thread;
    assert_eq!(t.status, Status::Resolved);
    assert_eq!(t.resolved_by.as_deref(), Some("Sam"));
    assert_roundtrips(src);
}

#[test]
fn multiple_threads_same_block_example() {
    let src = "```MarkdownComments\n- id: mc-005\n  quote: \"VS Code extension\"\n  comments:\n    - by: Anna\n      at: \"2026-06-05T08:09:00Z\"\n      text: Good first integration target.\n- id: mc-006\n  quote: \"Markdown Preview\"\n  comments:\n    - by: Dor\n      at: \"2026-06-05T08:10:00Z\"\n      text: Render like Mermaid, but safely.\n```\nFirst implementation targets a VS Code extension with Markdown Preview integration.\n";
    let doc = parse_document(src);
    assert_eq!(doc.fences.len(), 1);
    assert_eq!(doc.fences[0].threads.len(), 2);
    assert_eq!(doc.fences[0].threads[1].thread.id, "mc-006");
    assert_roundtrips(src);
}

#[test]
fn quote_with_yaml_special_chars_roundtrips() {
    // A quote containing colon, hash, leading dash, quotes, and emoji.
    let src = "```MarkdownComments\n- id: mc-010\n  quote: \"- a: b # c \\\"q\\\" \u{1F600}\"\n  comments:\n    - by: QA\n      at: \"2026-06-05T08:11:00Z\"\n      text: special\n```\n- a: b # c \"q\" \u{1F600} appears here.\n";
    let doc = parse_document(src);
    assert_eq!(
        doc.fences[0].threads[0].thread.quote.as_deref(),
        Some("- a: b # c \"q\" \u{1F600}")
    );
    assert_roundtrips(src);
}

#[test]
fn fence_chars_inside_block_scalar_are_not_a_closing_fence() {
    // An indented ``` inside a YAML block scalar must stay part of the comment
    // body, not truncate the fence.
    let src = "```MarkdownComments\n- id: mc-001\n  comments:\n    - by: A\n      at: \"2026-01-01T00:00:00Z\"\n      text: |-\n        before\n        ```\n        after\n```\nTarget paragraph.\n";
    let doc = parse_document(src);
    assert_eq!(doc.fences.len(), 1);
    let body = &doc.fences[0].threads[0].thread.comments[0].text;
    assert_eq!(body, "before\n```\nafter");
    assert_roundtrips(src);
}

#[test]
fn crlf_document_preserves_line_endings_on_edit() {
    let src = "```MarkdownComments\r\n- id: mc-001\r\n  comments:\r\n    - by: A\r\n      at: \"2026-01-01T00:00:00Z\"\r\n      text: hi\r\n```\r\nParagraph.\r\n";
    let r = mdc_core::edit::add_reply(src, "mc-001", "B", "2026-01-02T00:00:00Z", "reply");
    assert!(r.ok);
    let out = apply_edits(src, &r.edits);
    // Closing fence is still followed by CRLF, not a lone LF.
    assert!(out.contains("```\r\nParagraph."), "got: {out:?}");
    assert!(!out.contains("```\nParagraph"));
    // The re-emitted fence uses CRLF internally.
    assert!(out.contains("- id: mc-001\r\n"));
    let doc = parse_document(&out);
    assert_eq!(doc.fences[0].threads[0].thread.comments.len(), 2);
}

#[test]
fn full_edit_lifecycle() {
    // Create, reply, resolve, edit, reopen, delete — applied in sequence.
    let mut src = "A paragraph to comment on.\n".to_string();

    let r: EditResult = mdc_core::edit::create_thread(
        &src,
        2,
        Some("paragraph"),
        "Anna",
        "2026-06-05T09:00:00Z",
        "First.",
    );
    assert!(r.ok);
    assert_eq!(r.new_thread_id.as_deref(), Some("mc-001"));
    src = apply_edits(&src, &r.edits);

    let r = mdc_core::edit::add_reply(&src, "mc-001", "Dor", "2026-06-05T09:01:00Z", "Second.");
    src = apply_edits(&src, &r.edits);

    let r = mdc_core::edit::set_thread_status(
        &src,
        "mc-001",
        true,
        Some("Sam"),
        Some("2026-06-05T09:02:00Z"),
    );
    src = apply_edits(&src, &r.edits);
    let doc = parse_document(&src);
    assert!(doc.fences[0].threads[0].thread.is_resolved());
    assert_eq!(doc.fences[0].threads[0].thread.comments.len(), 2);

    let r = mdc_core::edit::edit_comment(&src, "mc-001", 0, "First edited.");
    src = apply_edits(&src, &r.edits);

    let r = mdc_core::edit::set_thread_status(&src, "mc-001", false, None, None);
    src = apply_edits(&src, &r.edits);
    let doc = parse_document(&src);
    assert!(!doc.fences[0].threads[0].thread.is_resolved());
    assert_eq!(
        doc.fences[0].threads[0].thread.comments[0].text,
        "First edited."
    );

    let r = mdc_core::edit::delete_thread(&src, "mc-001");
    src = apply_edits(&src, &r.edits);
    assert!(!src.contains("MarkdownComments"));
    assert!(src.starts_with("A paragraph to comment on."));
}

#[test]
fn reattach_moves_thread_to_a_new_block_creating_a_fence() {
    let src = "```MarkdownComments\n- id: mc-001\n  quote: \"Alpha\"\n  comments:\n    - by: A\n      at: \"2026-01-01T00:00:00Z\"\n      text: hi\n```\nAlpha block.\n\nBravo block.\n";
    let off = src.find("Bravo block.").unwrap();
    let r = mdc_core::edit::reattach_thread(src, "mc-001", Some("Bravo"), Some(off));
    assert!(r.ok);
    assert_eq!(
        r.edits.len(),
        2,
        "a move produces a source + destination edit"
    );
    let out = apply_edits(src, &r.edits);
    let doc = parse_document(&out);
    assert_eq!(
        doc.fences.len(),
        1,
        "source fence removed, one new fence created"
    );
    let pt = &doc.fences[0].threads[0];
    assert_eq!(pt.thread.id, "mc-001");
    assert_eq!(pt.thread.quote.as_deref(), Some("Bravo"));
    assert!(matches!(
        pt.anchor,
        mdc_core::model::AnchorState::Quoted { .. }
    ));
    assert_roundtrips(&out);
}

#[test]
fn reattach_appends_to_an_existing_destination_fence() {
    let src = "```MarkdownComments\n- id: mc-001\n  quote: \"Alpha\"\n  comments:\n    - by: A\n      at: \"2026-01-01T00:00:00Z\"\n      text: one\n```\nAlpha block.\n\n```MarkdownComments\n- id: mc-002\n  quote: \"Bravo\"\n  comments:\n    - by: B\n      at: \"2026-01-01T00:00:00Z\"\n      text: two\n```\nBravo block.\n";
    let off = src.find("Bravo block.").unwrap();
    let r = mdc_core::edit::reattach_thread(src, "mc-001", Some("Bravo"), Some(off));
    assert!(r.ok);
    let out = apply_edits(src, &r.edits);
    let doc = parse_document(&out);
    assert_eq!(doc.fences.len(), 1, "no second fence is created over Bravo");
    let ids: Vec<&str> = doc.fences[0]
        .threads
        .iter()
        .map(|t| t.thread.id.as_str())
        .collect();
    assert_eq!(ids, vec!["mc-002", "mc-001"]);
    assert_roundtrips(&out);
}

#[test]
fn anchor_is_stable_across_common_edits() {
    let base = "```MarkdownComments\n- id: mc-001\n  quote: \"target\"\n  comments:\n    - by: A\n      at: \"2026-01-01T00:00:00Z\"\n      text: hi\n```\nThe target paragraph here.\n";
    assert!(matches!(
        parse_document(base).fences[0].threads[0].anchor,
        mdc_core::model::AnchorState::Quoted { .. }
    ));

    // Inserting content above the fence shifts offsets but keeps the anchor.
    let above = format!("Intro added above.\n\n{base}");
    assert!(matches!(
        parse_document(&above).fences[0].threads[0].anchor,
        mdc_core::model::AnchorState::Quoted { .. }
    ));

    // Editing text after the quote within the same block keeps the anchor.
    let after = base.replace("paragraph here.", "paragraph here, now longer.");
    assert!(matches!(
        parse_document(&after).fences[0].threads[0].anchor,
        mdc_core::model::AnchorState::Quoted { .. }
    ));

    // Editing the quoted substring itself surfaces a needs-reattach, never a
    // silent mis-anchor.
    let drifted = base.replace("The target paragraph", "The tgt paragraph");
    assert!(matches!(
        parse_document(&drifted).fences[0].threads[0].anchor,
        mdc_core::model::AnchorState::NeedsReattach { .. }
    ));
}

#[test]
fn multiline_quote_with_fence_chars_roundtrips() {
    // A multi-line quote at thread indent (continuation indent 4) containing a
    // ``` line must survive emit/parse without splitting the fence — the
    // tightest fence-breakout path.
    let base = "Target block.\n";
    let multiline_quote = "line one\n```\nline three";
    let r = mdc_core::edit::create_thread(
        base,
        0,
        Some(multiline_quote),
        "A",
        "2026-01-01T00:00:00Z",
        "note",
    );
    assert!(r.ok);
    let out = apply_edits(base, &r.edits);
    let doc = parse_document(&out);
    assert_eq!(doc.fences.len(), 1);
    assert_eq!(doc.fences[0].threads.len(), 1, "no phantom thread forged");
    assert_eq!(
        doc.fences[0].threads[0].thread.quote.as_deref(),
        Some(multiline_quote)
    );
    assert_roundtrips(&out);
}

#[test]
fn stacked_fences_each_bind_the_next_block() {
    let src = "```MarkdownComments\n- id: mc-001\n  comments:\n    - by: A\n      at: \"2026-01-01T00:00:00Z\"\n      text: one\n```\n```MarkdownComments\n- id: mc-002\n  comments:\n    - by: B\n      at: \"2026-01-01T00:00:00Z\"\n      text: two\n```\nShared block.\n";
    let doc = parse_document(src);
    assert_eq!(doc.fences.len(), 2);
    let starts: Vec<usize> = doc
        .fences
        .iter()
        .map(|f| match f.target {
            mdc_core::model::Target::Block { start, .. } => start,
            _ => panic!("expected a block target"),
        })
        .collect();
    let shared = src.find("Shared block.").unwrap();
    assert_eq!(
        starts,
        vec![shared, shared],
        "both fences bind the same block"
    );
}

#[test]
fn ambiguous_quote_anchors_to_first_occurrence_in_block() {
    let src = "```MarkdownComments\n- id: mc-001\n  quote: \"DUP\"\n  comments:\n    - by: A\n      at: \"2026-01-01T00:00:00Z\"\n      text: hi\n```\nDUP first then DUP second.\n";
    let doc = parse_document(src);
    let (ts, te) = match doc.fences[0].target {
        mdc_core::model::Target::Block { start, end, .. } => (start, end),
        _ => panic!("expected block target"),
    };
    let first = ts + src[ts..te].find("DUP").unwrap();
    match doc.fences[0].threads[0].anchor {
        mdc_core::model::AnchorState::Quoted { start, .. } => assert_eq!(start, first),
        ref other => panic!("expected quoted anchor, got {other:?}"),
    }
}

#[test]
fn editing_an_ambiguous_duplicate_id_is_rejected() {
    let src = "```MarkdownComments\n- id: mc-001\n  comments:\n    - by: A\n      at: \"2026-01-01T00:00:00Z\"\n      text: one\n```\nBlock A.\n\n```MarkdownComments\n- id: mc-001\n  comments:\n    - by: B\n      at: \"2026-01-01T00:00:00Z\"\n      text: two\n```\nBlock B.\n";
    let r = mdc_core::edit::add_reply(src, "mc-001", "C", "2026-01-02T00:00:00Z", "reply");
    assert!(!r.ok, "editing an ambiguous id must be rejected");
    assert!(
        r.rejected.as_deref().unwrap_or("").contains("ambiguous"),
        "got: {:?}",
        r.rejected
    );
}
