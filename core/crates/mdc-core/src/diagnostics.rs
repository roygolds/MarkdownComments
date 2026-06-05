//! Diagnostic types reported by parsing and validation.

use crate::text::Range;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticCode {
    InvalidYaml,
    DuplicateId,
    ConflictMarkers,
    MissingRequiredField,
    EmptyComments,
    BadTimestamp,
    NonUtcTimestamp,
    MalformedId,
    NeedsReattach,
    AmbiguousCodeFenceTarget,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub code: DiagnosticCode,
    pub severity: Severity,
    pub message: String,
    pub range: Range,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub related_ranges: Vec<Range>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
}
