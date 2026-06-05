//! mdc-core: the pure, I/O-free engine for the MarkdownComments format.
//!
//! The core owns the format contract defined in `docs/format.md`. It is:
//!
//! - **Pure**: no clock, no file system, no identity. Callers supply author
//!   names, timestamps, and edited text.
//! - **Non-destructive**: invalid YAML, duplicate ids, and Git conflict markers
//!   become diagnostics; the core never auto-merges, renumbers, or drops data.
//! - **Deterministic**: all writing goes through [`emit`], and edits are
//!   minimal text replacements of a single fence.
//!
//! Positions inside this crate are UTF-8 byte offsets. The WASM layer converts
//! them to LSP `{line, character}` positions via [`text::LineIndex`].

pub mod anchor;
pub mod diagnostics;
pub mod edit;
pub mod emit;
pub mod ids;
pub mod model;
pub mod parse;
pub mod text;

use diagnostics::{Diagnostic, DiagnosticCode, Severity};
use model::{AnchorState, FenceChar, FenceParseState, Target, Thread};
use parse::scan::scan_blocks;
use std::collections::BTreeMap;
use text::{LineIndex, Range};

/// Crate semantic version, surfaced through the WASM `version()` export so the
/// extension can assert it loaded a compatible core.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// A single parsed thread together with its resolved anchor.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedThread {
    pub thread: Thread,
    pub anchor: AnchorState,
}

/// A parsed `MarkdownComments` fence: its source span, target, parse state, and
/// the threads it contains.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedFence {
    pub block_start: usize,
    pub block_end: usize,
    pub fence_char: FenceChar,
    pub fence_len: usize,
    pub target: Target,
    pub state: FenceParseState,
    pub threads: Vec<ParsedThread>,
}

/// The full result of parsing a document.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct ParsedDocument {
    pub fences: Vec<ParsedFence>,
    pub diagnostics: Vec<Diagnostic>,
}

/// Byte offset of the end of the line containing `offset` (excluding `\n`).
fn line_end_of(src: &str, offset: usize) -> usize {
    match src[offset..].find('\n') {
        Some(i) => offset + i,
        None => src.len(),
    }
}

/// Range covering the opening fence line, used to anchor fence-level
/// diagnostics compactly.
fn opening_line_range(li: &LineIndex, src: &str, block_start: usize) -> Range {
    li.range(src, block_start, line_end_of(src, block_start))
}

fn diag(code: DiagnosticCode, severity: Severity, message: String, range: Range) -> Diagnostic {
    Diagnostic {
        code,
        severity,
        message,
        range,
        related_ranges: Vec::new(),
        thread_id: None,
    }
}

/// Parse a document into fences, anchors, and diagnostics. Pure and total: any
/// malformed input is reported as diagnostics rather than failing.
pub fn parse_document(src: &str) -> ParsedDocument {
    let li = LineIndex::new(src);
    let conflicts = parse::conflict::scan(src);
    let blocks = scan_blocks(src, &li);

    let mut doc = ParsedDocument::default();
    let mut id_locations: BTreeMap<String, Vec<Range>> = BTreeMap::new();

    // Report conflict regions once.
    for region in &conflicts {
        doc.diagnostics.push(diag(
            DiagnosticCode::ConflictMarkers,
            Severity::Error,
            "Git conflict markers found; resolve them before editing comments.".to_string(),
            li.range(src, region.start, line_end_of(src, region.start)),
        ));
    }

    for (idx, block) in blocks.iter().enumerate() {
        let Some(fence) = &block.mdc else { continue };
        let target = anchor::target_for(&blocks, idx);
        let line_range = opening_line_range(&li, src, fence.block_start);

        let conflicted = parse::conflict::overlaps(&conflicts, fence.block_start, fence.block_end);

        let (state, parsed_threads) = if conflicted {
            (FenceParseState::ContainsConflict, Vec::new())
        } else {
            let payload = &src[fence.inner_start..fence.inner_end];
            match parse::yaml::load(payload) {
                Ok(threads) => {
                    let parsed = threads
                        .into_iter()
                        .map(|t| {
                            let anchor = anchor::anchor_thread(src, &target, &t);
                            ParsedThread { thread: t, anchor }
                        })
                        .collect::<Vec<_>>();
                    (FenceParseState::Parsed, parsed)
                }
                Err(message) => {
                    doc.diagnostics.push(diag(
                        DiagnosticCode::InvalidYaml,
                        Severity::Error,
                        format!("Invalid MarkdownComments YAML: {message}"),
                        line_range,
                    ));
                    (FenceParseState::InvalidYaml { message }, Vec::new())
                }
            }
        };

        // Per-thread validation diagnostics.
        for pt in &parsed_threads {
            let t = &pt.thread;
            id_locations
                .entry(t.id.clone())
                .or_default()
                .push(line_range);

            if !ids::is_canonical(&t.id) {
                doc.diagnostics.push(with_thread(
                    diag(
                        DiagnosticCode::MalformedId,
                        Severity::Info,
                        format!("Thread id '{}' is not in canonical mc-NNN form.", t.id),
                        line_range,
                    ),
                    &t.id,
                ));
            }
            if t.comments.is_empty() {
                doc.diagnostics.push(with_thread(
                    diag(
                        DiagnosticCode::EmptyComments,
                        Severity::Warning,
                        format!("Thread '{}' has no comments.", t.id),
                        line_range,
                    ),
                    &t.id,
                ));
            }
            for c in &t.comments {
                if let Some(code) = timestamp_issue(&c.at) {
                    doc.diagnostics
                        .push(with_thread(timestamp_diag(code, &c.at, line_range), &t.id));
                }
            }
            if let Some(ra) = &t.resolved_at {
                if let Some(code) = timestamp_issue(ra) {
                    doc.diagnostics
                        .push(with_thread(timestamp_diag(code, ra, line_range), &t.id));
                }
            }
            if let AnchorState::NeedsReattach { .. } = pt.anchor {
                doc.diagnostics.push(with_thread(
                    diag(
                        DiagnosticCode::NeedsReattach,
                        Severity::Warning,
                        format!(
                            "Thread '{}' needs reattach; its anchor was not found.",
                            t.id
                        ),
                        line_range,
                    ),
                    &t.id,
                ));
            }
        }

        doc.fences.push(ParsedFence {
            block_start: fence.block_start,
            block_end: fence.block_end,
            fence_char: fence.fence_char,
            fence_len: fence.fence_len,
            target,
            state,
            threads: parsed_threads,
        });
    }

    // Duplicate-id diagnostics across the whole document.
    for (id, ranges) in &id_locations {
        if ranges.len() > 1 {
            for r in ranges {
                let others: Vec<Range> = ranges.iter().filter(|x| *x != r).copied().collect();
                doc.diagnostics.push(Diagnostic {
                    code: DiagnosticCode::DuplicateId,
                    severity: Severity::Warning,
                    message: format!(
                        "Duplicate thread id '{id}' appears {} times in this file.",
                        ranges.len()
                    ),
                    range: *r,
                    related_ranges: others,
                    thread_id: Some(id.clone()),
                });
            }
        }
    }

    doc
}

fn with_thread(mut d: Diagnostic, id: &str) -> Diagnostic {
    d.thread_id = Some(id.to_string());
    d
}

fn timestamp_diag(code: DiagnosticCode, value: &str, range: Range) -> Diagnostic {
    let message = match code {
        DiagnosticCode::NonUtcTimestamp => {
            format!("Timestamp '{value}' is not UTC; store timestamps with a 'Z' suffix.")
        }
        _ => format!("Timestamp '{value}' is not a valid ISO-8601 UTC timestamp."),
    };
    diag(code, Severity::Warning, message, range)
}

/// Classify a stored timestamp string. Returns `None` when it is a valid UTC
/// ISO-8601 timestamp (`YYYY-MM-DDTHH:MM:SS[.fff]Z`).
fn timestamp_issue(s: &str) -> Option<DiagnosticCode> {
    let b = s.as_bytes();
    if s.len() < 19 {
        return Some(DiagnosticCode::BadTimestamp);
    }
    let sep_ok = b[4] == b'-' && b[7] == b'-' && b[10] == b'T' && b[13] == b':' && b[16] == b':';
    let digits_ok = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18]
        .iter()
        .all(|&i| b[i].is_ascii_digit());
    if !sep_ok || !digits_ok {
        return Some(DiagnosticCode::BadTimestamp);
    }
    let mut rest = &s[19..];
    // Optional fractional seconds.
    if let Some(stripped) = rest.strip_prefix('.') {
        let digits: usize = stripped.chars().take_while(|c| c.is_ascii_digit()).count();
        if digits == 0 {
            return Some(DiagnosticCode::BadTimestamp);
        }
        rest = &stripped[digits..];
    }
    match rest {
        "Z" => None,
        "" => Some(DiagnosticCode::NonUtcTimestamp),
        r if is_offset(r) => Some(DiagnosticCode::NonUtcTimestamp),
        _ => Some(DiagnosticCode::BadTimestamp),
    }
}

fn is_offset(r: &str) -> bool {
    let b = r.as_bytes();
    (r.len() == 6)
        && (b[0] == b'+' || b[0] == b'-')
        && b[1].is_ascii_digit()
        && b[2].is_ascii_digit()
        && b[3] == b':'
        && b[4].is_ascii_digit()
        && b[5].is_ascii_digit()
}

/// Collect every thread id in a parsed document, for id generation.
pub fn collect_ids(doc: &ParsedDocument) -> Vec<String> {
    doc.fences
        .iter()
        .flat_map(|f| f.threads.iter().map(|t| t.thread.id.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_examples_from_format_doc() {
        let src = "```MarkdownComments\n- id: mc-001\n  quote: \"version-control friendly\"\n  comments:\n    - by: Yulia\n      at: \"2026-06-05T08:03:51Z\"\n      text: Make this promise more concrete.\n```\nMarkdownComments keeps Markdown readable and version-control friendly.\n";
        let doc = parse_document(src);
        assert_eq!(doc.fences.len(), 1);
        let f = &doc.fences[0];
        assert_eq!(f.state, FenceParseState::Parsed);
        assert_eq!(f.threads.len(), 1);
        assert_eq!(f.threads[0].thread.id, "mc-001");
        assert!(matches!(f.threads[0].anchor, AnchorState::Quoted { .. }));
        assert!(doc.diagnostics.is_empty());
    }

    #[test]
    fn reports_duplicate_ids() {
        let src = "```MarkdownComments\n- id: mc-001\n  comments:\n    - by: A\n      at: \"2026-01-01T00:00:00Z\"\n      text: one\n```\nPara one.\n\n```MarkdownComments\n- id: mc-001\n  comments:\n    - by: B\n      at: \"2026-01-01T00:00:00Z\"\n      text: two\n```\nPara two.\n";
        let doc = parse_document(src);
        let dups: Vec<_> = doc
            .diagnostics
            .iter()
            .filter(|d| d.code == DiagnosticCode::DuplicateId)
            .collect();
        assert_eq!(dups.len(), 2);
    }

    #[test]
    fn reports_invalid_yaml() {
        let src = "```MarkdownComments\n- id: [broken\n```\nPara.\n";
        let doc = parse_document(src);
        assert!(doc
            .diagnostics
            .iter()
            .any(|d| d.code == DiagnosticCode::InvalidYaml));
        assert!(matches!(
            doc.fences[0].state,
            FenceParseState::InvalidYaml { .. }
        ));
    }

    #[test]
    fn reports_conflict_markers() {
        let src = "<<<<<<< ours\n```MarkdownComments\n- id: mc-001\n  comments: []\n```\n=======\nx\n>>>>>>> theirs\nPara.\n";
        let doc = parse_document(src);
        assert!(doc
            .diagnostics
            .iter()
            .any(|d| d.code == DiagnosticCode::ConflictMarkers));
    }

    #[test]
    fn flags_non_utc_timestamp() {
        let src = "```MarkdownComments\n- id: mc-001\n  comments:\n    - by: A\n      at: \"2026-01-01T00:00:00+03:00\"\n      text: hi\n```\nPara.\n";
        let doc = parse_document(src);
        assert!(doc
            .diagnostics
            .iter()
            .any(|d| d.code == DiagnosticCode::NonUtcTimestamp));
    }

    #[test]
    fn valid_utc_timestamp_has_no_diagnostic() {
        assert_eq!(timestamp_issue("2026-06-05T08:03:51Z"), None);
        assert_eq!(timestamp_issue("2026-06-05T08:03:51.123Z"), None);
    }
}
