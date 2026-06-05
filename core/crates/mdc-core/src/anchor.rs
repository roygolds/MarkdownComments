//! Resolve a fence's target block and each thread's anchor within it.
//!
//! Anchoring rules (see `docs/format.md`):
//! - A fence attaches to the next non-blank, non-comment block after it.
//! - A comment fence is never the target of another comment fence.
//! - A heading target is the heading line only.
//! - A fence with no following block is detached and needs reattach.
//! - With a `quote`, the thread anchors to the first occurrence of that text
//!   inside the target block; otherwise it covers the whole block.

use crate::model::{AnchorState, ReattachReason, Target, Thread};
use crate::parse::scan::Block;

/// Determine the target block for the fence at `blocks[fence_idx]`.
pub fn target_for(blocks: &[Block], fence_idx: usize) -> Target {
    for block in &blocks[fence_idx + 1..] {
        if block.mdc.is_some() {
            continue;
        }
        return Target::Block {
            start: block.start,
            end: block.end,
            block_type: block.block_type,
        };
    }
    Target::Detached
}

/// Resolve a single thread's anchor against its fence target.
pub fn anchor_thread(src: &str, target: &Target, thread: &Thread) -> AnchorState {
    let (start, end) = match target {
        Target::Detached => {
            return AnchorState::NeedsReattach {
                reason: ReattachReason::NoTargetBlock,
            }
        }
        Target::Block { start, end, .. } => (*start, *end),
    };

    match &thread.quote {
        None => AnchorState::WholeBlock { start, end },
        Some(q) => {
            let hay = &src[start..end];
            match hay.find(q.as_str()) {
                Some(rel) => AnchorState::Quoted {
                    start: start + rel,
                    end: start + rel + q.len(),
                },
                None => AnchorState::NeedsReattach {
                    reason: ReattachReason::QuoteNotFound,
                },
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{BlockType, Comment, Status};
    use crate::parse::scan::scan_blocks;
    use crate::text::LineIndex;

    fn thread(quote: Option<&str>) -> Thread {
        Thread {
            id: "mc-001".into(),
            status: Status::Open,
            quote: quote.map(|s| s.to_string()),
            resolved_by: None,
            resolved_at: None,
            comments: vec![Comment {
                by: "A".into(),
                at: "2026-01-01T00:00:00Z".into(),
                text: "hi".into(),
            }],
        }
    }

    #[test]
    fn whole_block_when_no_quote() {
        let src = "```MarkdownComments\n- id: mc-001\n  comments: []\n```\nHello world.\n";
        let li = LineIndex::new(src);
        let blocks = scan_blocks(src, &li);
        let fence_idx = blocks.iter().position(|b| b.mdc.is_some()).unwrap();
        let target = target_for(&blocks, fence_idx);
        match target {
            Target::Block { block_type, .. } => assert_eq!(block_type, BlockType::Paragraph),
            _ => panic!("expected block target"),
        }
        let st = anchor_thread(src, &target, &thread(None));
        assert!(matches!(st, AnchorState::WholeBlock { .. }));
    }

    #[test]
    fn quoted_anchor_resolves_substring() {
        let src = "```MarkdownComments\n- id: mc-001\n  comments: []\n```\nHello world.\n";
        let li = LineIndex::new(src);
        let blocks = scan_blocks(src, &li);
        let fence_idx = blocks.iter().position(|b| b.mdc.is_some()).unwrap();
        let target = target_for(&blocks, fence_idx);
        let st = anchor_thread(src, &target, &thread(Some("world")));
        match st {
            AnchorState::Quoted { start, end } => assert_eq!(&src[start..end], "world"),
            _ => panic!("expected quoted anchor"),
        }
    }

    #[test]
    fn missing_quote_needs_reattach() {
        let src = "```MarkdownComments\n- id: mc-001\n  comments: []\n```\nHello world.\n";
        let li = LineIndex::new(src);
        let blocks = scan_blocks(src, &li);
        let fence_idx = blocks.iter().position(|b| b.mdc.is_some()).unwrap();
        let target = target_for(&blocks, fence_idx);
        let st = anchor_thread(src, &target, &thread(Some("absent")));
        assert!(matches!(
            st,
            AnchorState::NeedsReattach {
                reason: ReattachReason::QuoteNotFound
            }
        ));
    }

    #[test]
    fn detached_at_eof() {
        let src = "Some text.\n\n```MarkdownComments\n- id: mc-001\n  comments: []\n```\n";
        let li = LineIndex::new(src);
        let blocks = scan_blocks(src, &li);
        let fence_idx = blocks.iter().position(|b| b.mdc.is_some()).unwrap();
        let target = target_for(&blocks, fence_idx);
        assert_eq!(target, Target::Detached);
        let st = anchor_thread(src, &target, &thread(None));
        assert!(matches!(
            st,
            AnchorState::NeedsReattach {
                reason: ReattachReason::NoTargetBlock
            }
        ));
    }
}
