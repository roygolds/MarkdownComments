//! Data model for MarkdownComments threads and comments.
//!
//! These types mirror the format contract in `docs/format.md`. They are used
//! both for parsing (reading) the YAML payload inside a `MarkdownComments`
//! fence and as the in-memory model that the deterministic emitter renders.

use serde::{Deserialize, Serialize};

/// Resolution state of a comment thread. Defaults to `Open` when the `status`
/// field is absent in the YAML payload.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    #[default]
    Open,
    Resolved,
}

/// A single message within a thread. `text` is plain text and may be
/// multi-line; it is never rendered as Markdown.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Comment {
    pub by: String,
    pub at: String,
    pub text: String,
}

/// A comment thread: a conversation attached to the next Markdown block, with
/// a file-local unique id and an ordered list of comments (oldest first).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub id: String,
    #[serde(default)]
    pub status: Status,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quote: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_at: Option<String>,
    #[serde(default)]
    pub comments: Vec<Comment>,
}

impl Thread {
    pub fn is_resolved(&self) -> bool {
        self.status == Status::Resolved
    }
}

/// The block type of an anchor target, used for display and for narrowing the
/// region searched for a `quote`.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BlockType {
    Paragraph,
    Heading,
    ListItem,
    Table,
    BlockQuote,
    CodeFence,
    Html,
    ThematicBreak,
    Other,
}

/// How a fence relates to the block it comments on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    /// Bound to the next non-blank, non-comment block after the closing fence.
    Block {
        start: usize,
        end: usize,
        block_type: BlockType,
    },
    /// No following block (e.g. a fence at end of file).
    Detached,
}

/// Why a thread requires manual reattach.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReattachReason {
    QuoteNotFound,
    NoTargetBlock,
}

/// The resolved anchor of a single thread against its fence target, in absolute
/// byte offsets into the document source.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AnchorState {
    WholeBlock { start: usize, end: usize },
    Quoted { start: usize, end: usize },
    NeedsReattach { reason: ReattachReason },
}

/// The character used for a fenced code block.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FenceChar {
    Backtick,
    Tilde,
}

impl FenceChar {
    pub fn as_char(self) -> char {
        match self {
            FenceChar::Backtick => '`',
            FenceChar::Tilde => '~',
        }
    }
}

/// Parse state of a single fence payload.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FenceParseState {
    Parsed,
    InvalidYaml { message: String },
    ContainsConflict,
}
