//! Line indexing and byte-offset <-> LSP position mapping.
//!
//! Internally the core works entirely in UTF-8 byte offsets (what
//! `pulldown-cmark` reports). VS Code positions are line + UTF-16 code unit
//! column, so this module performs the conversion in one well-tested place.

/// A zero-based LSP-style position: line plus UTF-16 code-unit character.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Position {
    pub line: u32,
    pub character: u32,
}

/// A range of [start, end) positions.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Range {
    pub start: Position,
    pub end: Position,
}

/// Precomputed start byte offset of every line in a document.
pub struct LineIndex {
    /// Byte offset of the first character of each line.
    line_starts: Vec<usize>,
    len: usize,
}

impl LineIndex {
    pub fn new(src: &str) -> Self {
        let mut line_starts = vec![0usize];
        for (i, b) in src.bytes().enumerate() {
            if b == b'\n' {
                line_starts.push(i + 1);
            }
        }
        LineIndex {
            line_starts,
            len: src.len(),
        }
    }

    /// Map a byte offset to an LSP position. `src` must be the same string the
    /// index was built from.
    pub fn position(&self, src: &str, offset: usize) -> Position {
        let offset = offset.min(self.len);
        // Binary search for the line whose start is <= offset.
        let line = match self.line_starts.binary_search(&offset) {
            Ok(l) => l,
            Err(l) => l - 1,
        };
        let line_start = self.line_starts[line];
        // UTF-16 column: count UTF-16 code units between line_start and offset.
        let slice = &src[line_start..offset];
        let character = slice.chars().map(|c| c.len_utf16() as u32).sum();
        Position {
            line: line as u32,
            character,
        }
    }

    pub fn range(&self, src: &str, start: usize, end: usize) -> Range {
        Range {
            start: self.position(src, start),
            end: self.position(src, end),
        }
    }

    /// Map an LSP position back to a byte offset. Clamps to line and document
    /// bounds. `src` must be the same string the index was built from.
    pub fn offset_at(&self, src: &str, pos: Position) -> usize {
        let line = pos.line as usize;
        if line >= self.line_starts.len() {
            return self.len;
        }
        let line_start = self.line_starts[line];
        let line_end = if line + 1 < self.line_starts.len() {
            self.line_starts[line + 1]
        } else {
            self.len
        };
        let mut utf16 = 0u32;
        let mut off = line_start;
        for c in src[line_start..line_end].chars() {
            if utf16 >= pos.character {
                break;
            }
            utf16 += c.len_utf16() as u32;
            off += c.len_utf8();
        }
        off
    }

    /// Byte offset of the start of the line containing `offset`.
    pub fn line_start_of(&self, offset: usize) -> usize {
        let offset = offset.min(self.len);
        let line = match self.line_starts.binary_search(&offset) {
            Ok(l) => l,
            Err(l) => l - 1,
        };
        self.line_starts[line]
    }
}

/// Detect the prevailing newline style of a document.
pub fn newline_style(src: &str) -> &'static str {
    if src.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_positions() {
        let src = "abc\ndef\n";
        let idx = LineIndex::new(src);
        assert_eq!(
            idx.position(src, 0),
            Position {
                line: 0,
                character: 0
            }
        );
        assert_eq!(
            idx.position(src, 1),
            Position {
                line: 0,
                character: 1
            }
        );
        assert_eq!(
            idx.position(src, 4),
            Position {
                line: 1,
                character: 0
            }
        );
        assert_eq!(
            idx.position(src, 6),
            Position {
                line: 1,
                character: 2
            }
        );
    }

    #[test]
    fn utf16_columns_count_surrogate_pairs() {
        // "😀" is one scalar but two UTF-16 code units.
        let src = "a😀b";
        let idx = LineIndex::new(src);
        // byte offset of 'b' is 1 + 4 = 5
        let pos = idx.position(src, 5);
        assert_eq!(
            pos,
            Position {
                line: 0,
                character: 3
            }
        );
    }

    #[test]
    fn newline_detection() {
        assert_eq!(newline_style("a\r\nb"), "\r\n");
        assert_eq!(newline_style("a\nb"), "\n");
        assert_eq!(newline_style("abc"), "\n");
    }
}
