//! Edit operations: parse -> modify model -> re-emit the affected fence as a
//! single minimal text replacement.
//!
//! Every mutation returns an [`EditResult`] carrying byte-offset [`TextEdit`]s.
//! The core never applies edits itself (so it stays I/O- and state-free); the
//! WASM layer converts offsets to LSP positions and the editor applies them.
//! Edits are expressed in original-document coordinates and must be applied in
//! descending start order (see [`apply_edits`]).

use crate::emit::emit_fence;
use crate::ids;
use crate::model::{Comment, FenceChar, FenceParseState, Status, Target, Thread};
use crate::parse::scan::{scan_blocks, Block};
use crate::text::{newline_style, LineIndex};
use crate::{parse_document, ParsedFence};

/// A minimal text replacement in byte offsets: replace `[start, end)` with
/// `new_text`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextEdit {
    pub start: usize,
    pub end: usize,
    pub new_text: String,
}

/// The outcome of an edit operation.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct EditResult {
    pub ok: bool,
    pub edits: Vec<TextEdit>,
    pub new_thread_id: Option<String>,
    /// Human-readable reason the edit was rejected, when `ok` is false.
    pub rejected: Option<String>,
}

impl EditResult {
    fn rejected(reason: impl Into<String>) -> Self {
        EditResult {
            ok: false,
            edits: Vec::new(),
            new_thread_id: None,
            rejected: Some(reason.into()),
        }
    }

    fn ok(edits: Vec<TextEdit>) -> Self {
        EditResult {
            ok: true,
            edits,
            new_thread_id: None,
            rejected: None,
        }
    }
}

/// Apply edits to a source string. Used by native tests and any non-LSP caller.
/// Edits must not overlap; they are applied from the highest start offset down.
pub fn apply_edits(src: &str, edits: &[TextEdit]) -> String {
    let mut sorted: Vec<&TextEdit> = edits.iter().collect();
    sorted.sort_by_key(|e| std::cmp::Reverse(e.start));
    let mut out = src.to_string();
    for e in sorted {
        out.replace_range(e.start..e.end, &e.new_text);
    }
    out
}

/// Find the parsed fence (in `doc`) and the index of `thread_id` within it.
///
/// Returns an error if the id is missing, or if it is ambiguous (the same id
/// appears more than once in the document — a supported-but-flagged state after
/// a Git merge). Editing an ambiguous id is rejected so an operation can never
/// silently mutate the wrong thread; the duplicate must be resolved first.
fn locate_thread<'a>(
    doc: &'a crate::ParsedDocument,
    thread_id: &str,
) -> Result<(&'a ParsedFence, usize), &'static str> {
    let mut found: Option<(&'a ParsedFence, usize)> = None;
    let mut count = 0usize;
    for fence in &doc.fences {
        for (i, t) in fence.threads.iter().enumerate() {
            if t.thread.id == thread_id {
                count += 1;
                if found.is_none() {
                    found = Some((fence, i));
                }
            }
        }
    }
    match (found, count) {
        (Some(v), 1) => Ok(v),
        (Some(_), _) => {
            Err("thread id is ambiguous (appears multiple times); resolve the duplicate id first")
        }
        (None, _) => Err("thread not found"),
    }
}

fn threads_of(fence: &ParsedFence) -> Vec<Thread> {
    fence.threads.iter().map(|t| t.thread.clone()).collect()
}

/// Build a single replacement edit that re-emits `fence` with `threads`.
fn replace_fence(src: &str, fence: &ParsedFence, threads: &[Thread]) -> TextEdit {
    let nl = newline_style(src);
    let text = emit_fence(threads, fence.fence_char, fence.fence_len, nl);
    TextEdit {
        start: fence.block_start,
        end: fence.block_end,
        new_text: text,
    }
}

/// Build an edit that removes the whole fence plus one trailing newline.
fn remove_fence(src: &str, block_start: usize, block_end: usize) -> TextEdit {
    let mut end = block_end;
    if src[end..].starts_with("\r\n") {
        end += 2;
    } else if src[end..].starts_with('\n') {
        end += 1;
    }
    TextEdit {
        start: block_start,
        end,
        new_text: String::new(),
    }
}

/// Re-emit `fence` with `threads`, or remove the fence entirely if empty.
fn write_back(src: &str, fence: &ParsedFence, threads: Vec<Thread>) -> TextEdit {
    if threads.is_empty() {
        remove_fence(src, fence.block_start, fence.block_end)
    } else {
        replace_fence(src, fence, &threads)
    }
}

fn guard_editable(fence: &ParsedFence) -> Option<EditResult> {
    match fence.state {
        FenceParseState::Parsed => None,
        FenceParseState::InvalidYaml { .. } => {
            Some(EditResult::rejected("fence contains invalid YAML"))
        }
        FenceParseState::ContainsConflict => {
            Some(EditResult::rejected("fence overlaps a Git conflict region"))
        }
    }
}

/// Append a reply to an existing thread.
pub fn add_reply(src: &str, thread_id: &str, by: &str, at: &str, text: &str) -> EditResult {
    let doc = parse_document(src);
    let (fence, idx) = match locate_thread(&doc, thread_id) {
        Ok(v) => v,
        Err(msg) => return EditResult::rejected(msg),
    };
    if let Some(r) = guard_editable(fence) {
        return r;
    }
    let mut threads = threads_of(fence);
    threads[idx].comments.push(Comment {
        by: by.to_string(),
        at: at.to_string(),
        text: text.to_string(),
    });
    EditResult::ok(vec![replace_fence(src, fence, &threads)])
}

/// Edit the text of an existing comment.
pub fn edit_comment(
    src: &str,
    thread_id: &str,
    comment_index: usize,
    new_text: &str,
) -> EditResult {
    let doc = parse_document(src);
    let (fence, idx) = match locate_thread(&doc, thread_id) {
        Ok(v) => v,
        Err(msg) => return EditResult::rejected(msg),
    };
    if let Some(r) = guard_editable(fence) {
        return r;
    }
    let mut threads = threads_of(fence);
    if comment_index >= threads[idx].comments.len() {
        return EditResult::rejected("comment index out of range");
    }
    threads[idx].comments[comment_index].text = new_text.to_string();
    EditResult::ok(vec![replace_fence(src, fence, &threads)])
}

/// Resolve or reopen a thread, recording resolver identity/time when resolving.
pub fn set_thread_status(
    src: &str,
    thread_id: &str,
    resolved: bool,
    by: Option<&str>,
    at: Option<&str>,
) -> EditResult {
    let doc = parse_document(src);
    let (fence, idx) = match locate_thread(&doc, thread_id) {
        Ok(v) => v,
        Err(msg) => return EditResult::rejected(msg),
    };
    if let Some(r) = guard_editable(fence) {
        return r;
    }
    let mut threads = threads_of(fence);
    let t = &mut threads[idx];
    if resolved {
        t.status = Status::Resolved;
        t.resolved_by = by.map(str::to_string);
        t.resolved_at = at.map(str::to_string);
    } else {
        t.status = Status::Open;
        t.resolved_by = None;
        t.resolved_at = None;
    }
    EditResult::ok(vec![replace_fence(src, fence, &threads)])
}

/// Delete a whole thread, removing the fence if it becomes empty.
pub fn delete_thread(src: &str, thread_id: &str) -> EditResult {
    let doc = parse_document(src);
    let (fence, idx) = match locate_thread(&doc, thread_id) {
        Ok(v) => v,
        Err(msg) => return EditResult::rejected(msg),
    };
    if let Some(r) = guard_editable(fence) {
        return r;
    }
    let mut threads = threads_of(fence);
    threads.remove(idx);
    EditResult::ok(vec![write_back(src, fence, threads)])
}

/// Delete a single comment. Deletes the thread (and fence) if it was the last
/// comment in the thread.
pub fn delete_comment(src: &str, thread_id: &str, comment_index: usize) -> EditResult {
    let doc = parse_document(src);
    let (fence, idx) = match locate_thread(&doc, thread_id) {
        Ok(v) => v,
        Err(msg) => return EditResult::rejected(msg),
    };
    if let Some(r) = guard_editable(fence) {
        return r;
    }
    let mut threads = threads_of(fence);
    if comment_index >= threads[idx].comments.len() {
        return EditResult::rejected("comment index out of range");
    }
    threads[idx].comments.remove(comment_index);
    if threads[idx].comments.is_empty() {
        threads.remove(idx);
    }
    EditResult::ok(vec![write_back(src, fence, threads)])
}

/// Find the non-comment block that contains `offset`.
fn block_at(blocks: &[Block], offset: usize) -> Option<usize> {
    blocks
        .iter()
        .position(|b| b.mdc.is_none() && b.start <= offset && offset < b.end)
        .or_else(|| {
            // Fall back to the first block starting at/after the offset.
            blocks
                .iter()
                .position(|b| b.mdc.is_none() && b.start >= offset)
        })
}

/// The fence that already targets `blocks[block_idx]`, if one is stacked
/// immediately above it.
fn fence_above(blocks: &[Block], block_idx: usize) -> Option<usize> {
    if block_idx == 0 {
        return None;
    }
    blocks[..block_idx]
        .iter()
        .rposition(|b| b.mdc.is_some())
        .filter(|&i| blocks[i + 1..block_idx].iter().all(|b| b.mdc.is_some()))
}

/// Create a new thread anchored to the block containing `anchor_offset`.
///
/// `quote` is the optional selected substring; `None` means a whole-block
/// comment. Returns the generated id in `new_thread_id`.
pub fn create_thread(
    src: &str,
    anchor_offset: usize,
    quote: Option<&str>,
    by: &str,
    at: &str,
    text: &str,
) -> EditResult {
    let li = LineIndex::new(src);
    let blocks = scan_blocks(src, &li);
    let Some(block_idx) = block_at(&blocks, anchor_offset) else {
        return EditResult::rejected("no Markdown block at the given position");
    };

    let doc = parse_document(src);
    let existing = crate::collect_ids(&doc);
    let new_id = ids::next_id(existing.iter().map(String::as_str));

    let new_thread = Thread {
        id: new_id.clone(),
        status: Status::Open,
        quote: quote.map(str::to_string),
        resolved_by: None,
        resolved_at: None,
        comments: vec![Comment {
            by: by.to_string(),
            at: at.to_string(),
            text: text.to_string(),
        }],
    };

    let edit = match fence_above(&blocks, block_idx) {
        Some(scan_idx) => {
            let block_start = blocks[scan_idx].start;
            let Some(fence) = doc.fences.iter().find(|f| f.block_start == block_start) else {
                return EditResult::rejected("internal: fence not parsed");
            };
            if let Some(r) = guard_editable(fence) {
                return r;
            }
            let mut threads = threads_of(fence);
            threads.push(new_thread);
            replace_fence(src, fence, &threads)
        }
        None => {
            let nl = newline_style(src);
            let fence_text = emit_fence(&[new_thread], FenceChar::Backtick, 3, nl);
            let at_pos = blocks[block_idx].start;
            TextEdit {
                start: at_pos,
                end: at_pos,
                new_text: format!("{fence_text}{nl}"),
            }
        }
    };

    let mut result = EditResult::ok(vec![edit]);
    result.new_thread_id = Some(new_id);
    result
}

/// Reattach a thread by updating its `quote`, optionally moving it to the block
/// containing `new_anchor_offset`.
pub fn reattach_thread(
    src: &str,
    thread_id: &str,
    new_quote: Option<&str>,
    new_anchor_offset: Option<usize>,
) -> EditResult {
    let doc = parse_document(src);
    let (fence, idx) = match locate_thread(&doc, thread_id) {
        Ok(v) => v,
        Err(msg) => return EditResult::rejected(msg),
    };
    if let Some(r) = guard_editable(fence) {
        return r;
    }

    let current_target_start = match fence.target {
        Target::Block { start, .. } => Some(start),
        Target::Detached => None,
    };

    let li = LineIndex::new(src);
    let blocks = scan_blocks(src, &li);

    // Decide whether this is an in-place quote update or a move.
    let move_target = new_anchor_offset.and_then(|off| block_at(&blocks, off));
    let is_move = match (move_target, current_target_start) {
        (Some(bi), Some(cur)) => blocks[bi].start != cur,
        (Some(_), None) => true,
        _ => false,
    };

    if !is_move {
        let mut threads = threads_of(fence);
        threads[idx].quote = new_quote.map(str::to_string);
        return EditResult::ok(vec![replace_fence(src, fence, &threads)]);
    }

    // Move: detach the thread from its current fence and insert it at the new
    // target block, carrying its id/comments/status forward.
    let target_block_idx = move_target.unwrap();
    let mut moved = fence.threads[idx].thread.clone();
    moved.quote = new_quote.map(str::to_string);

    let mut remaining = threads_of(fence);
    remaining.remove(idx);
    let source_edit = write_back(src, fence, remaining);

    let dest_edit = match fence_above(&blocks, target_block_idx) {
        Some(scan_idx) => {
            let block_start = blocks[scan_idx].start;
            // Avoid double-counting if destination fence is the source fence.
            if block_start == fence.block_start {
                // Same fence: just update quote in place instead.
                let mut threads = threads_of(fence);
                threads[idx].quote = new_quote.map(str::to_string);
                return EditResult::ok(vec![replace_fence(src, fence, &threads)]);
            }
            let Some(dest) = doc.fences.iter().find(|f| f.block_start == block_start) else {
                return EditResult::rejected("internal: destination fence not parsed");
            };
            if let Some(r) = guard_editable(dest) {
                return r;
            }
            let mut threads = threads_of(dest);
            threads.push(moved);
            replace_fence(src, dest, &threads)
        }
        None => {
            let nl = newline_style(src);
            let fence_text = emit_fence(&[moved], FenceChar::Backtick, 3, nl);
            let at_pos = blocks[target_block_idx].start;
            TextEdit {
                start: at_pos,
                end: at_pos,
                new_text: format!("{fence_text}{nl}"),
            }
        }
    };

    EditResult::ok(vec![source_edit, dest_edit])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::AnchorState;

    const DOC: &str = "```MarkdownComments\n- id: mc-001\n  quote: \"world\"\n  comments:\n    - by: Yulia\n      at: \"2026-06-05T08:03:51Z\"\n      text: First note.\n```\nHello world here.\n";

    fn parse(src: &str) -> crate::ParsedDocument {
        parse_document(src)
    }

    #[test]
    fn add_reply_appends_comment() {
        let r = add_reply(DOC, "mc-001", "Mark", "2026-06-05T09:00:00Z", "A reply.");
        assert!(r.ok);
        let out = apply_edits(DOC, &r.edits);
        let doc = parse(&out);
        assert_eq!(doc.fences[0].threads[0].thread.comments.len(), 2);
        assert_eq!(doc.fences[0].threads[0].thread.comments[1].text, "A reply.");
    }

    #[test]
    fn edit_comment_changes_text() {
        let r = edit_comment(DOC, "mc-001", 0, "Edited note.");
        let out = apply_edits(DOC, &r.edits);
        let doc = parse(&out);
        assert_eq!(
            doc.fences[0].threads[0].thread.comments[0].text,
            "Edited note."
        );
    }

    #[test]
    fn resolve_and_reopen() {
        let r = set_thread_status(
            DOC,
            "mc-001",
            true,
            Some("Sam"),
            Some("2026-06-05T10:00:00Z"),
        );
        let out = apply_edits(DOC, &r.edits);
        let doc = parse(&out);
        assert!(doc.fences[0].threads[0].thread.is_resolved());
        assert_eq!(
            doc.fences[0].threads[0].thread.resolved_by.as_deref(),
            Some("Sam")
        );

        let r2 = set_thread_status(&out, "mc-001", false, None, None);
        let out2 = apply_edits(&out, &r2.edits);
        let doc2 = parse(&out2);
        assert!(!doc2.fences[0].threads[0].thread.is_resolved());
        assert!(doc2.fences[0].threads[0].thread.resolved_by.is_none());
    }

    #[test]
    fn delete_only_comment_removes_fence() {
        let r = delete_comment(DOC, "mc-001", 0);
        let out = apply_edits(DOC, &r.edits);
        assert!(!out.contains("MarkdownComments"));
        assert!(out.starts_with("Hello world here."));
    }

    #[test]
    fn delete_thread_removes_fence() {
        let r = delete_thread(DOC, "mc-001");
        let out = apply_edits(DOC, &r.edits);
        assert!(!out.contains("MarkdownComments"));
    }

    #[test]
    fn create_thread_inserts_new_fence() {
        let src = "Just a paragraph here.\n";
        let off = 5; // inside the paragraph
        let r = create_thread(
            src,
            off,
            Some("paragraph"),
            "Anna",
            "2026-06-05T11:00:00Z",
            "New thread.",
        );
        assert!(r.ok);
        assert_eq!(r.new_thread_id.as_deref(), Some("mc-001"));
        let out = apply_edits(src, &r.edits);
        let doc = parse(&out);
        assert_eq!(doc.fences.len(), 1);
        assert_eq!(doc.fences[0].threads[0].thread.id, "mc-001");
        assert!(matches!(
            doc.fences[0].threads[0].anchor,
            AnchorState::Quoted { .. }
        ));
    }

    #[test]
    fn create_thread_appends_to_existing_fence() {
        // anchor offset inside the paragraph that follows the existing fence.
        let off = DOC.find("Hello world here.").unwrap();
        let r = create_thread(
            DOC,
            off,
            None,
            "Dor",
            "2026-06-05T12:00:00Z",
            "Second thread.",
        );
        assert!(r.ok);
        assert_eq!(r.new_thread_id.as_deref(), Some("mc-002"));
        let out = apply_edits(DOC, &r.edits);
        let doc = parse(&out);
        assert_eq!(doc.fences.len(), 1);
        assert_eq!(doc.fences[0].threads.len(), 2);
        assert_eq!(doc.fences[0].threads[1].thread.id, "mc-002");
    }

    #[test]
    fn reattach_updates_quote_in_place() {
        let r = reattach_thread(DOC, "mc-001", Some("Hello"), None);
        let out = apply_edits(DOC, &r.edits);
        let doc = parse(&out);
        assert_eq!(
            doc.fences[0].threads[0].thread.quote.as_deref(),
            Some("Hello")
        );
        assert!(matches!(
            doc.fences[0].threads[0].anchor,
            AnchorState::Quoted { .. }
        ));
    }

    #[test]
    fn rejects_unknown_thread() {
        assert!(!add_reply(DOC, "mc-999", "X", "2026-06-05T09:00:00Z", "hi").ok);
    }
}
