//! Thread id parsing and generation.
//!
//! Canonical ids have the form `mc-NNN` where `NNN` is a zero-padded (minimum
//! width 3) decimal counter. Generation computes the maximum existing numeric
//! suffix across all ids in the document and adds one, so ids never collide
//! even when duplicates are present.

/// Parse the numeric suffix of a canonical `mc-NNN` id. Returns `None` for ids
/// that do not match the canonical shape.
pub fn parse_suffix(id: &str) -> Option<u64> {
    let rest = id.strip_prefix("mc-")?;
    if rest.is_empty() || !rest.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    rest.parse::<u64>().ok()
}

/// Returns true if the id is in canonical `mc-NNN` form.
pub fn is_canonical(id: &str) -> bool {
    parse_suffix(id).is_some()
}

/// Compute the next id given all existing ids in a document.
pub fn next_id<'a, I>(existing: I) -> String
where
    I: IntoIterator<Item = &'a str>,
{
    let max = existing
        .into_iter()
        .filter_map(parse_suffix)
        .max()
        .unwrap_or(0);
    format!("mc-{:03}", max + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_canonical_suffix() {
        assert_eq!(parse_suffix("mc-001"), Some(1));
        assert_eq!(parse_suffix("mc-042"), Some(42));
        assert_eq!(parse_suffix("mc-7"), Some(7));
    }

    #[test]
    fn rejects_non_canonical() {
        assert_eq!(parse_suffix("mc-"), None);
        assert_eq!(parse_suffix("mc-1a"), None);
        assert_eq!(parse_suffix("thread-1"), None);
        assert_eq!(parse_suffix("mc001"), None);
    }

    #[test]
    fn next_id_is_max_plus_one() {
        assert_eq!(next_id(["mc-001", "mc-003", "mc-002"]), "mc-004");
        assert_eq!(next_id(["mc-006", "mc-006"]), "mc-007");
        assert_eq!(next_id::<[&str; 0]>([]), "mc-001");
        assert_eq!(next_id(["custom"]), "mc-001");
    }
}
