// Types mirroring the JSON shapes returned by the mdc-wasm core.
// Positions are LSP-style (zero-based line + UTF-16 character).

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export type Severity = "error" | "warning" | "info";

export type DiagnosticCode =
  | "invalidYaml"
  | "duplicateId"
  | "conflictMarkers"
  | "missingRequiredField"
  | "emptyComments"
  | "badTimestamp"
  | "nonUtcTimestamp"
  | "malformedId"
  | "needsReattach"
  | "ambiguousCodeFenceTarget";

export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  range: Range;
  relatedRanges?: Range[];
  threadId?: string;
}

export interface CommentView {
  by: string;
  at: string;
  text: string;
}

export interface AnchorView {
  kind: "wholeBlock" | "quoted" | "needsReattach";
  range?: Range;
  reason?: "quoteNotFound" | "noTargetBlock";
}

export interface ThreadView {
  id: string;
  status: "open" | "resolved";
  quote?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  comments: CommentView[];
  anchor: AnchorView;
}

export interface TargetView {
  kind: "block" | "detached";
  range?: Range;
  blockType?: string;
}

export interface StateView {
  kind: "parsed" | "invalidYaml" | "containsConflict";
  message?: string;
}

export interface FenceView {
  range: Range;
  target: TargetView;
  state: StateView;
  threads: ThreadView[];
}

export interface ParseResult {
  fences: FenceView[];
  diagnostics: Diagnostic[];
}

export interface TextEditView {
  range: Range;
  newText: string;
}

export interface EditResult {
  ok: boolean;
  edits: TextEditView[];
  newThreadId?: string;
  rejected?: string;
}
