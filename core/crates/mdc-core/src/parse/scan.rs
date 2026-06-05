//! Locate `MarkdownComments` fences and top-level Markdown blocks with exact
//! source spans, using `pulldown-cmark` for structure only (never rendering).

use crate::model::{BlockType, FenceChar};
use crate::text::LineIndex;
use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag};

pub const INFO_STRING: &str = "MarkdownComments";

/// A `MarkdownComments` fence with the spans needed for parsing and editing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MdcFence {
    /// Start of the opening fence line (includes indentation).
    pub block_start: usize,
    /// End of the closing fence line (excludes its trailing newline). Equals the
    /// document end for an unterminated fence.
    pub block_end: usize,
    /// Start of the inner YAML payload (first byte after the opening line).
    pub inner_start: usize,
    /// End of the inner YAML payload (start of the closing fence line).
    pub inner_end: usize,
    pub fence_char: FenceChar,
    pub fence_len: usize,
    pub indent: usize,
}

/// A top-level Markdown block.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Block {
    pub start: usize,
    pub end: usize,
    pub block_type: BlockType,
    /// `Some` when this block is a `MarkdownComments` fence.
    pub mdc: Option<MdcFence>,
}

fn classify(tag: &Tag) -> BlockType {
    match tag {
        Tag::Paragraph => BlockType::Paragraph,
        Tag::Heading { .. } => BlockType::Heading,
        Tag::BlockQuote(_) => BlockType::BlockQuote,
        Tag::CodeBlock(_) => BlockType::CodeFence,
        Tag::List(_) => BlockType::ListItem,
        Tag::Table(_) => BlockType::Table,
        Tag::HtmlBlock => BlockType::Html,
        _ => BlockType::Other,
    }
}

fn fence_info(tag: &Tag) -> Option<String> {
    if let Tag::CodeBlock(CodeBlockKind::Fenced(info)) = tag {
        Some(info.to_string())
    } else {
        None
    }
}

/// Analyze the opening and closing fence lines of a fenced code block.
fn analyze_fence(src: &str, li: &LineIndex, range: std::ops::Range<usize>) -> Option<MdcFence> {
    let block_start = li.line_start_of(range.start);
    let first_line_end = src[block_start..]
        .find('\n')
        .map(|i| block_start + i)
        .unwrap_or(src.len());
    let first_line = &src[block_start..first_line_end];
    let indent = first_line.len() - first_line.trim_start().len();
    let after_indent = &first_line[indent..];
    let fence_char = if after_indent.starts_with("```") {
        FenceChar::Backtick
    } else if after_indent.starts_with("~~~") {
        FenceChar::Tilde
    } else {
        return None;
    };
    let fc = fence_char.as_char();
    let fence_len = after_indent.chars().take_while(|&c| c == fc).count();

    let inner_start = (first_line_end + 1).min(src.len());

    // Find the closing fence line. Per CommonMark, a closing fence may be
    // indented at most 3 spaces, must be at least as long as the opening fence,
    // and consist only of fence characters (plus trailing whitespace). Lines
    // indented 4+ spaces are content (e.g. fence characters inside a block
    // scalar) and must not be mistaken for the close. Trailing whitespace,
    // including a CR in CRLF documents, is excluded from `block_end` so a
    // replacement edit preserves the original line ending.
    let mut inner_end = range.end.min(src.len());
    let mut block_end = range.end.min(src.len());
    let mut offset = inner_start;
    for line in src[inner_start..range.end.min(src.len())].split_inclusive('\n') {
        let trimmed_nl = line.strip_suffix('\n').unwrap_or(line);
        let leading = trimmed_nl.len() - trimmed_nl.trim_start_matches(' ').len();
        let content = trimmed_nl.trim_end();
        let body = content.get(leading..).unwrap_or("");
        let is_close = leading <= 3
            && !body.is_empty()
            && body.chars().all(|c| c == fc)
            && body.len() >= fence_len;
        if is_close {
            inner_end = offset;
            block_end = offset + content.len();
            break;
        }
        offset += line.len();
    }

    Some(MdcFence {
        block_start,
        block_end,
        inner_start,
        inner_end,
        fence_char,
        fence_len,
        indent,
    })
}

/// Scan a document and return its top-level blocks in source order.
pub fn scan_blocks(src: &str, li: &LineIndex) -> Vec<Block> {
    let mut blocks = Vec::new();
    let mut depth = 0usize;
    let parser = Parser::new_ext(src, Options::all());
    for (event, range) in parser.into_offset_iter() {
        match event {
            Event::Start(tag) => {
                if depth == 0 {
                    let block_type = classify(&tag);
                    let mdc = if fence_info(&tag).as_deref().map(str::trim) == Some(INFO_STRING) {
                        analyze_fence(src, li, range.clone())
                    } else {
                        None
                    };
                    blocks.push(Block {
                        start: range.start,
                        end: range.end,
                        block_type,
                        mdc,
                    });
                }
                depth += 1;
            }
            Event::End(_) => {
                depth = depth.saturating_sub(1);
            }
            Event::Rule if depth == 0 => {
                blocks.push(Block {
                    start: range.start,
                    end: range.end,
                    block_type: BlockType::ThematicBreak,
                    mdc: None,
                });
            }
            _ => {}
        }
    }
    blocks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_mdc_fence_and_target() {
        let src = "```MarkdownComments\n- id: mc-001\n  comments:\n    - by: A\n      at: \"2026-01-01T00:00:00Z\"\n      text: hi\n```\nHello world.\n";
        let li = LineIndex::new(src);
        let blocks = scan_blocks(src, &li);
        let fences: Vec<_> = blocks.iter().filter(|b| b.mdc.is_some()).collect();
        assert_eq!(fences.len(), 1);
        let f = fences[0].mdc.as_ref().unwrap();
        let inner = &src[f.inner_start..f.inner_end];
        assert!(inner.contains("mc-001"));
        // The next non-fence block is the paragraph.
        let para = blocks
            .iter()
            .find(|b| b.block_type == BlockType::Paragraph)
            .unwrap();
        assert_eq!(&src[para.start..para.end].trim(), &"Hello world.");
    }

    #[test]
    fn detects_tilde_fence() {
        let src = "~~~MarkdownComments\n- id: mc-001\n  comments: []\n~~~\nText\n";
        let li = LineIndex::new(src);
        let blocks = scan_blocks(src, &li);
        let f = blocks.iter().find_map(|b| b.mdc.as_ref()).unwrap();
        assert_eq!(f.fence_char, FenceChar::Tilde);
    }
}
