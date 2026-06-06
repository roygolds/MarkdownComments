// Precedence helper for the comments sidebar's recomputeTarget(). Kept as
// dependency-free JavaScript (no vscode imports) so it can be unit-tested with
// the fast mocha runner, while the extension imports it through
// customPreviewTarget.d.ts. Mirrors sidebarTarget.js / activeTabKind.js.
//
// WHY THIS EXISTS: VS Code's built-in Markdown preview can surface as a CUSTOM
// editor (TabInputCustom with viewType "vscode.markdown.preview.editor"). Unlike
// the WEBVIEW preview, that tab input exposes the backing document uri DIRECTLY
// via `input.uri`, which is authoritative for "which document is being
// previewed". chooseSidebarTarget()'s built-in-preview branch has an anti-churn
// shortcut that KEEPS the current target while it is still a loaded markdown doc;
// that shortcut is wrong when the user switches to a preview of a DIFFERENT file
// (the old target is still loaded, so the sidebar would keep showing it). When a
// custom-editor preview uri is known it must override that heuristic — but NOT
// override a focused Markdown source editor or our own interactive preview panel,
// both of which rank higher in recomputeTarget()'s precedence.
"use strict";

/**
 * @param {{
 *   activeMarkdownEditorUri: string | null, // active editor uri IFF markdown, else null
 *   panelSourceUri: string | null,          // CommentsPreviewPanel.activeSourceUri() or null
 *   customPreviewUri: string | null         // backing uri of an active custom-editor markdown preview, else null
 * }} state
 * @returns {string | null} the uri to target DIRECTLY (bypassing chooseSidebarTarget's
 *   anti-churn heuristic), or null meaning "defer to chooseSidebarTarget".
 */
function chooseCustomPreviewOverride(state) {
  // A focused markdown source editor or our interactive panel rank higher than a
  // built-in preview; defer to chooseSidebarTarget so they win (branches a/b).
  if (state.activeMarkdownEditorUri || state.panelSourceUri) {
    return null;
  }
  // The custom-editor preview's backing uri is authoritative: target it directly.
  return state.customPreviewUri || null;
}

module.exports = { chooseCustomPreviewOverride };
