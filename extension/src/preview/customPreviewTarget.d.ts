// Type surface for customPreviewTarget.js (authored as dependency-free JS so the
// unit tests can require it without TypeScript compilation). Mirrors
// sidebarTarget.d.ts / activeTabKind.d.ts.

/** Inputs to the custom-editor-preview precedence override. */
export interface CustomPreviewOverrideState {
  /** Active editor uri IFF it is markdown, else null. */
  activeMarkdownEditorUri: string | null;
  /** CommentsPreviewPanel.activeSourceUri() or null. */
  panelSourceUri: string | null;
  /** Backing uri of an active custom-editor markdown preview, else null. */
  customPreviewUri: string | null;
}

/**
 * Resolve the custom-editor markdown preview's backing uri as the sidebar target,
 * bypassing chooseSidebarTarget()'s anti-churn heuristic, UNLESS a focused
 * markdown source editor or our interactive preview panel rank higher (in which
 * case it returns null to defer to chooseSidebarTarget).
 */
export function chooseCustomPreviewOverride(state: CustomPreviewOverrideState): string | null;
