//! Git conflict-marker detection (line based).
//!
//! Detects regions delimited by `<<<<<<< `, `=======`, `>>>>>>> ` (and the
//! diff3 `||||||| ` separator). The core never attempts to merge sides; it only
//! reports regions so the caller can avoid destructive edits.

/// A byte range covering a conflict region (from the `<<<<<<<` line to the end
/// of the `>>>>>>>` line).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ConflictRegion {
    pub start: usize,
    pub end: usize,
}

fn line_kind(line: &str) -> Option<u8> {
    if line.starts_with("<<<<<<<") {
        Some(b'<')
    } else if line.starts_with("=======") && line.trim_end().len() == 7 {
        Some(b'=')
    } else if line.starts_with(">>>>>>>") {
        Some(b'>')
    } else if line.starts_with("|||||||") {
        Some(b'|')
    } else {
        None
    }
}

/// Scan a document for conflict regions.
///
/// A region normally spans from a `<<<<<<<` line to the end of its matching
/// `>>>>>>>` line. An *unterminated* conflict (a `<<<<<<<` with no closing
/// `>>>>>>>`) still indicates a broken merge, so it is reported as a region
/// extending to the end of the document rather than being silently ignored.
pub fn scan(src: &str) -> Vec<ConflictRegion> {
    let mut regions = Vec::new();
    let mut open: Option<usize> = None;
    let mut offset = 0usize;
    for line in src.split_inclusive('\n') {
        let trimmed = line.strip_suffix('\n').unwrap_or(line);
        match line_kind(trimmed) {
            Some(b'<') => open = Some(offset),
            Some(b'>') => {
                if let Some(start) = open.take() {
                    regions.push(ConflictRegion {
                        start,
                        end: offset + trimmed.len(),
                    });
                }
            }
            _ => {}
        }
        offset += line.len();
    }
    if let Some(start) = open {
        regions.push(ConflictRegion {
            start,
            end: src.len(),
        });
    }
    regions
}

/// True if any conflict region overlaps the [start, end) byte range.
pub fn overlaps(regions: &[ConflictRegion], start: usize, end: usize) -> bool {
    regions.iter().any(|r| r.start < end && start < r.end)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_simple_conflict() {
        let src = "a\n<<<<<<< ours\nx\n=======\ny\n>>>>>>> theirs\nb\n";
        let regions = scan(src);
        assert_eq!(regions.len(), 1);
        let r = regions[0];
        assert!(src[r.start..r.end].starts_with("<<<<<<<"));
        assert!(src[r.start..r.end].ends_with("theirs"));
    }

    #[test]
    fn no_conflict() {
        assert!(scan("just normal\ntext\n").is_empty());
    }

    #[test]
    fn detects_unterminated_conflict() {
        // A dangling `<<<<<<<` with no closing marker still flags a region
        // (extending to EOF) so edits near it are blocked.
        let src = "a\n<<<<<<< ours\nx\n=======\ny\nb\n";
        let regions = scan(src);
        assert_eq!(regions.len(), 1);
        let r = regions[0];
        assert!(src[r.start..r.end].starts_with("<<<<<<<"));
        assert_eq!(r.end, src.len());
    }
}
