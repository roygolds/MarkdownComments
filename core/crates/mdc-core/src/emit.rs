//! Deterministic, canonical emitter for `MarkdownComments` fences.
//!
//! All writing goes through this module so that edits never depend on how the
//! original YAML was formatted. The emitter normalizes only the single fence it
//! renders; surrounding document bytes are untouched by callers.
//!
//! Canonical layout (2-space indentation):
//!
//! ```text
//! ```MarkdownComments
//! - id: mc-001
//!   status: resolved        # only emitted when resolved
//!   quote: "..."            # only when present
//!   resolvedBy: ...         # only when present
//!   resolvedAt: "..."       # only when present
//!   comments:
//!     - by: Name
//!       at: "2026-..Z"
//!       text: hello
//! ```
//! ```

use crate::model::{FenceChar, Status, Thread};

/// Render the inner YAML payload (without the fence lines) for a list of
/// threads. Lines are joined with `\n`; the caller substitutes the document
/// newline style.
pub fn emit_payload(threads: &[Thread]) -> String {
    let mut out = String::new();
    for thread in threads {
        emit_thread(&mut out, thread);
    }
    out
}

/// Render a whole fence block (opening line, payload, closing line) using the
/// given fence character/length and newline style. No trailing newline is
/// appended after the closing fence.
pub fn emit_fence(
    threads: &[Thread],
    fence_char: FenceChar,
    fence_len: usize,
    newline: &str,
) -> String {
    let fence = fence_char.as_char().to_string().repeat(fence_len);
    let payload = emit_payload(threads);
    let mut lines: Vec<&str> = Vec::new();
    let opening = format!("{fence}MarkdownComments");
    lines.push(&opening);
    // payload already ends with '\n' per line; split into lines preserving none.
    let payload_lines: Vec<&str> = if payload.is_empty() {
        Vec::new()
    } else {
        payload.lines().collect()
    };
    lines.extend(payload_lines);
    lines.push(&fence);
    lines.join(newline)
}

fn emit_thread(out: &mut String, t: &Thread) {
    out.push_str("- id: ");
    out.push_str(&scalar(&t.id));
    out.push('\n');
    if t.status == Status::Resolved {
        out.push_str("  status: resolved\n");
    }
    if let Some(q) = &t.quote {
        push_field(out, "  ", "quote", q);
    }
    if let Some(rb) = &t.resolved_by {
        push_field(out, "  ", "resolvedBy", rb);
    }
    if let Some(ra) = &t.resolved_at {
        push_field(out, "  ", "resolvedAt", ra);
    }
    out.push_str("  comments:");
    if t.comments.is_empty() {
        out.push_str(" []\n");
        return;
    }
    out.push('\n');
    for c in &t.comments {
        push_field(out, "    - ", "by", &c.by);
        push_field(out, "      ", "at", &c.at);
        push_field(out, "      ", "text", &c.text);
    }
}

/// Emit `<indent><key>: <value>` choosing plain, double-quoted, or block scalar.
fn push_field(out: &mut String, indent: &str, key: &str, value: &str) {
    out.push_str(indent);
    out.push_str(key);
    out.push(':');
    if value.contains('\n') && block_safe(value) {
        out.push_str(" |-\n");
        // Continuation indent: align under the key (indent width + 2).
        let cont = " ".repeat(indent.len() + 2);
        for line in value.split('\n') {
            if line.is_empty() {
                out.push('\n');
            } else {
                out.push_str(&cont);
                out.push_str(line);
                out.push('\n');
            }
        }
    } else {
        out.push(' ');
        out.push_str(&scalar(value));
        out.push('\n');
    }
}

/// Render a single-line scalar: plain when safe, otherwise double-quoted.
fn scalar(s: &str) -> String {
    if plain_safe(s) {
        s.to_string()
    } else {
        double_quote(s)
    }
}

fn double_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 0x20 => {
                // Escape other C0 control characters so YAML round-trips them.
                out.push_str(&format!("\\x{:02X}", c as u32));
            }
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

/// True when a value can be safely written as a plain (unquoted) scalar.
fn plain_safe(s: &str) -> bool {
    if s.is_empty() || s != s.trim() || s.contains('\n') {
        return false;
    }
    let first = s.chars().next().unwrap();
    if !first.is_ascii_alphanumeric() {
        return false;
    }
    if s.contains(": ") || s.ends_with(':') || s.contains(" #") {
        return false;
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || " -._,()/'".contains(c))
    {
        return false;
    }
    let low = s.to_ascii_lowercase();
    if matches!(
        low.as_str(),
        "true" | "false" | "null" | "yes" | "no" | "on" | "off" | "~"
    ) {
        return false;
    }
    if s.parse::<f64>().is_ok() {
        return false;
    }
    true
}

/// True when a multi-line value can be safely written as a `|-` block scalar.
fn block_safe(s: &str) -> bool {
    if !s.contains('\n') || s.ends_with('\n') {
        return false;
    }
    for line in s.split('\n') {
        if line.starts_with(' ') || line.starts_with('\t') {
            return false;
        }
        if line != line.trim_end() {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Comment;

    fn comment(by: &str, text: &str) -> Comment {
        Comment {
            by: by.into(),
            at: "2026-06-05T08:03:51Z".into(),
            text: text.into(),
        }
    }

    fn base(id: &str) -> Thread {
        Thread {
            id: id.into(),
            status: Status::Open,
            quote: None,
            resolved_by: None,
            resolved_at: None,
            comments: vec![comment("Yulia", "Make this concrete.")],
        }
    }

    #[test]
    fn open_thread_omits_status() {
        let p = emit_payload(&[base("mc-001")]);
        assert!(!p.contains("status:"));
        assert!(p.contains("- id: mc-001"));
        assert!(p.contains("    - by: Yulia"));
        assert!(p.contains("      at: \"2026-06-05T08:03:51Z\""));
        assert!(p.contains("      text: Make this concrete."));
    }

    #[test]
    fn resolved_thread_emits_status_and_fields() {
        let mut t = base("mc-004");
        t.status = Status::Resolved;
        t.resolved_by = Some("Sam".into());
        t.resolved_at = Some("2026-06-05T08:08:30Z".into());
        let p = emit_payload(&[t]);
        assert!(p.contains("  status: resolved"));
        assert!(p.contains("  resolvedBy: Sam"));
        assert!(p.contains("  resolvedAt: \"2026-06-05T08:08:30Z\""));
    }

    #[test]
    fn multiline_text_uses_block_scalar() {
        let mut t = base("mc-002");
        t.comments[0].text = "line one\nline two".into();
        let p = emit_payload(&[t]);
        assert!(p.contains("      text: |-\n"));
        assert!(p.contains("        line one\n"));
        assert!(p.contains("        line two\n"));
    }

    #[test]
    fn special_chars_are_quoted() {
        let mut t = base("mc-007");
        t.quote = Some("a: b # c".into());
        let p = emit_payload(&[t]);
        assert!(p.contains("  quote: \"a: b # c\""));
    }

    #[test]
    fn fence_roundtrips_through_loader() {
        let fence = emit_fence(&[base("mc-001")], FenceChar::Backtick, 3, "\n");
        assert!(fence.starts_with("```MarkdownComments\n"));
        assert!(fence.ends_with("\n```"));
    }
}
