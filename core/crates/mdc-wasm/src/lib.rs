//! WASM bindings for `mdc-core`.
//!
//! These exports are stateless and synchronous: text in, result out. All byte
//! offsets from the core are converted here to LSP `{line, character}`
//! positions (UTF-16) so the TypeScript extension can apply edits directly.

use mdc_core::diagnostics::Diagnostic;
use mdc_core::edit;
use mdc_core::model::{AnchorState, BlockType, FenceParseState, ReattachReason, Status, Target};
use mdc_core::text::{LineIndex, Position, Range};
use mdc_core::{parse_document, ParsedDocument, ParsedFence, ParsedThread};
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ParseResultView {
    fences: Vec<FenceView>,
    diagnostics: Vec<Diagnostic>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FenceView {
    range: Range,
    target: TargetView,
    state: StateView,
    threads: Vec<ThreadView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StateView {
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TargetView {
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    range: Option<Range>,
    #[serde(skip_serializing_if = "Option::is_none")]
    block_type: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadView {
    id: String,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    quote: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    resolved_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    resolved_at: Option<String>,
    comments: Vec<CommentView>,
    anchor: AnchorView,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommentView {
    by: String,
    at: String,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AnchorView {
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    range: Option<Range>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TextEditView {
    range: Range,
    new_text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EditResultView {
    ok: bool,
    edits: Vec<TextEditView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    new_thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rejected: Option<String>,
}

fn status_str(s: Status) -> &'static str {
    match s {
        Status::Open => "open",
        Status::Resolved => "resolved",
    }
}

fn block_type_str(b: BlockType) -> &'static str {
    match b {
        BlockType::Paragraph => "paragraph",
        BlockType::Heading => "heading",
        BlockType::ListItem => "listItem",
        BlockType::Table => "table",
        BlockType::BlockQuote => "blockQuote",
        BlockType::CodeFence => "codeFence",
        BlockType::Html => "html",
        BlockType::ThematicBreak => "thematicBreak",
        BlockType::Other => "other",
    }
}

fn reattach_reason_str(r: ReattachReason) -> &'static str {
    match r {
        ReattachReason::QuoteNotFound => "quoteNotFound",
        ReattachReason::NoTargetBlock => "noTargetBlock",
    }
}

fn anchor_view(src: &str, li: &LineIndex, a: &AnchorState) -> AnchorView {
    match a {
        AnchorState::WholeBlock { start, end } => AnchorView {
            kind: "wholeBlock",
            range: Some(li.range(src, *start, *end)),
            reason: None,
        },
        AnchorState::Quoted { start, end } => AnchorView {
            kind: "quoted",
            range: Some(li.range(src, *start, *end)),
            reason: None,
        },
        AnchorState::NeedsReattach { reason } => AnchorView {
            kind: "needsReattach",
            range: None,
            reason: Some(reattach_reason_str(*reason)),
        },
    }
}

fn target_view(src: &str, li: &LineIndex, t: &Target) -> TargetView {
    match t {
        Target::Block {
            start,
            end,
            block_type,
        } => TargetView {
            kind: "block",
            range: Some(li.range(src, *start, *end)),
            block_type: Some(block_type_str(*block_type)),
        },
        Target::Detached => TargetView {
            kind: "detached",
            range: None,
            block_type: None,
        },
    }
}

fn state_view(s: &FenceParseState) -> StateView {
    match s {
        FenceParseState::Parsed => StateView {
            kind: "parsed",
            message: None,
        },
        FenceParseState::InvalidYaml { message } => StateView {
            kind: "invalidYaml",
            message: Some(message.clone()),
        },
        FenceParseState::ContainsConflict => StateView {
            kind: "containsConflict",
            message: None,
        },
    }
}

fn thread_view(src: &str, li: &LineIndex, pt: &ParsedThread) -> ThreadView {
    let t = &pt.thread;
    ThreadView {
        id: t.id.clone(),
        status: status_str(t.status),
        quote: t.quote.clone(),
        resolved_by: t.resolved_by.clone(),
        resolved_at: t.resolved_at.clone(),
        comments: t
            .comments
            .iter()
            .map(|c| CommentView {
                by: c.by.clone(),
                at: c.at.clone(),
                text: c.text.clone(),
            })
            .collect(),
        anchor: anchor_view(src, li, &pt.anchor),
    }
}

fn fence_view(src: &str, li: &LineIndex, f: &ParsedFence) -> FenceView {
    FenceView {
        range: li.range(src, f.block_start, f.block_end),
        target: target_view(src, li, &f.target),
        state: state_view(&f.state),
        threads: f.threads.iter().map(|t| thread_view(src, li, t)).collect(),
    }
}

fn parse_view(src: &str, doc: &ParsedDocument) -> ParseResultView {
    let li = LineIndex::new(src);
    ParseResultView {
        fences: doc.fences.iter().map(|f| fence_view(src, &li, f)).collect(),
        diagnostics: doc.diagnostics.clone(),
    }
}

fn edit_view(src: &str, r: edit::EditResult) -> EditResultView {
    let li = LineIndex::new(src);
    EditResultView {
        ok: r.ok,
        edits: r
            .edits
            .into_iter()
            .map(|e| TextEditView {
                range: li.range(src, e.start, e.end),
                new_text: e.new_text,
            })
            .collect(),
        new_thread_id: r.new_thread_id,
        rejected: r.rejected,
    }
}

fn to_js<T: Serialize>(v: &T) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(v).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Parse a document into fences, anchors, and diagnostics.
#[wasm_bindgen]
pub fn parse(text: &str) -> Result<JsValue, JsValue> {
    let doc = parse_document(text);
    to_js(&parse_view(text, &doc))
}

/// Return only the diagnostics for a document.
#[wasm_bindgen]
pub fn validate(text: &str) -> Result<JsValue, JsValue> {
    let doc = parse_document(text);
    to_js(&doc.diagnostics)
}

/// Compute the next canonical thread id for a document.
#[wasm_bindgen(js_name = nextThreadId)]
pub fn next_thread_id(text: &str) -> String {
    let doc = parse_document(text);
    let ids = mdc_core::collect_ids(&doc);
    mdc_core::ids::next_id(ids.iter().map(String::as_str))
}

/// The core crate version.
#[wasm_bindgen]
pub fn version() -> String {
    mdc_core::VERSION.to_string()
}

#[wasm_bindgen(js_name = createThread)]
pub fn create_thread(
    text: &str,
    line: u32,
    character: u32,
    quote: Option<String>,
    by: &str,
    at: &str,
    body: &str,
) -> Result<JsValue, JsValue> {
    let li = LineIndex::new(text);
    let offset = li.offset_at(text, Position { line, character });
    let r = edit::create_thread(text, offset, quote.as_deref(), by, at, body);
    to_js(&edit_view(text, r))
}

#[wasm_bindgen(js_name = addReply)]
pub fn add_reply(
    text: &str,
    thread_id: &str,
    by: &str,
    at: &str,
    body: &str,
) -> Result<JsValue, JsValue> {
    let r = edit::add_reply(text, thread_id, by, at, body);
    to_js(&edit_view(text, r))
}

#[wasm_bindgen(js_name = editComment)]
pub fn edit_comment(
    text: &str,
    thread_id: &str,
    comment_index: usize,
    new_text: &str,
) -> Result<JsValue, JsValue> {
    let r = edit::edit_comment(text, thread_id, comment_index, new_text);
    to_js(&edit_view(text, r))
}

#[wasm_bindgen(js_name = setThreadStatus)]
pub fn set_thread_status(
    text: &str,
    thread_id: &str,
    resolved: bool,
    by: Option<String>,
    at: Option<String>,
) -> Result<JsValue, JsValue> {
    let r = edit::set_thread_status(text, thread_id, resolved, by.as_deref(), at.as_deref());
    to_js(&edit_view(text, r))
}

#[wasm_bindgen(js_name = deleteThread)]
pub fn delete_thread(text: &str, thread_id: &str) -> Result<JsValue, JsValue> {
    let r = edit::delete_thread(text, thread_id);
    to_js(&edit_view(text, r))
}

#[wasm_bindgen(js_name = deleteComment)]
pub fn delete_comment(
    text: &str,
    thread_id: &str,
    comment_index: usize,
) -> Result<JsValue, JsValue> {
    let r = edit::delete_comment(text, thread_id, comment_index);
    to_js(&edit_view(text, r))
}

#[wasm_bindgen(js_name = reattachThread)]
pub fn reattach_thread(
    text: &str,
    thread_id: &str,
    new_quote: Option<String>,
    line: Option<u32>,
    character: Option<u32>,
) -> Result<JsValue, JsValue> {
    let offset = match (line, character) {
        (Some(l), Some(c)) => {
            let li = LineIndex::new(text);
            Some(li.offset_at(
                text,
                Position {
                    line: l,
                    character: c,
                },
            ))
        }
        _ => None,
    };
    let r = edit::reattach_thread(text, thread_id, new_quote.as_deref(), offset);
    to_js(&edit_view(text, r))
}
