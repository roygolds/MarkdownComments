//! Safe YAML loading of a fence payload into the thread model.
//!
//! Reading is delegated to `serde_yaml`; the deterministic emitter
//! (`crate::emit`) handles all writing so edits never depend on the reader's
//! formatting choices.

use crate::model::Thread;

/// Load the inner YAML payload of a fence into a list of threads.
///
/// Returns the parsed threads, or an error message suitable for an
/// `InvalidYaml` diagnostic. An empty or whitespace-only payload yields an
/// empty list rather than an error.
pub fn load(payload: &str) -> Result<Vec<Thread>, String> {
    if payload.trim().is_empty() {
        return Ok(Vec::new());
    }
    match serde_yaml::from_str::<Vec<Thread>>(payload) {
        Ok(threads) => Ok(threads),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Status;

    #[test]
    fn loads_single_thread() {
        let payload = "- id: mc-001\n  quote: \"selected\"\n  comments:\n    - by: A\n      at: \"2026-01-01T00:00:00Z\"\n      text: hello\n";
        let threads = load(payload).unwrap();
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].id, "mc-001");
        assert_eq!(threads[0].status, Status::Open);
        assert_eq!(threads[0].quote.as_deref(), Some("selected"));
        assert_eq!(threads[0].comments.len(), 1);
        assert_eq!(threads[0].comments[0].text, "hello");
    }

    #[test]
    fn loads_resolved_thread() {
        let payload = "- id: mc-004\n  status: resolved\n  resolvedBy: Sam\n  resolvedAt: \"2026-06-05T08:08:30Z\"\n  comments:\n    - by: Maya\n      at: \"2026-06-05T08:06:00Z\"\n      text: please add\n";
        let threads = load(payload).unwrap();
        assert!(threads[0].is_resolved());
        assert_eq!(threads[0].resolved_by.as_deref(), Some("Sam"));
    }

    #[test]
    fn empty_payload_is_empty_list() {
        assert!(load("   \n  ").unwrap().is_empty());
    }

    #[test]
    fn invalid_yaml_errors() {
        assert!(load("- id: [unclosed").is_err());
    }
}
