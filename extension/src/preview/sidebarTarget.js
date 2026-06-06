// Pure routing decision for which document the comments sidebar should target.
// Kept as dependency-free JavaScript (no vscode imports) so it can be unit-tested
// directly with the fast mocha runner, while the extension imports it through
// sidebarTarget.d.ts. This mirrors revealRouting.js.
//
// The sidebar follows "what the user is actually looking at". The tricky case is
// VS Code's BUILT-IN Markdown preview: when that preview tab is opened/active
// BEFORE the user ever focuses the Markdown source editor, there is no active
// Markdown text editor and the built-in preview's tab input exposes NO source
// resource URI. Previously the target stayed undefined and the sidebar rendered
// blank until the user switched to the source editor and back. KEY FACT: while a
// built-in preview is live, VS Code keeps the backing Markdown TextDocument
// loaded in workspace.textDocuments, so the source document IS resolvable from
// the open Markdown documents even when no editor/tab shows it.
"use strict";

/**
 * Decode a uri's last path segment (its basename) for label matching. Falls back
 * to the raw last segment when decoding fails (e.g. malformed percent-encoding).
 * @param {string} uri
 * @returns {string}
 */
function basenameOf(uri) {
  // Strip any query/fragment, then take the final path segment.
  const withoutHash = uri.split("#")[0].split("?")[0];
  const segments = withoutHash.split("/");
  const last = segments[segments.length - 1] || "";
  try {
    return decodeURIComponent(last);
  } catch (_e) {
    return last;
  }
}

/**
 * @param {{
 *   activeMarkdownEditorUri: string | null, // active editor uri IFF it is markdown, else null
 *   panelSourceUri: string | null,          // CommentsPreviewPanel.activeSourceUri() or null
 *   builtInPreviewActive: boolean,          // isBuiltInPreviewActive()
 *   openMarkdownUris: string[],             // uris of loaded markdown TextDocuments
 *   previewTabLabel: string | null,         // active tab label when the built-in preview is active
 *   currentTargetUri: string | null         // the sidebar's existing targetUri
 * }} state
 * @returns {string | null} the uri to target, or null meaning "keep the current target (no change)"
 */
function chooseSidebarTarget(state) {
  // a. The user is editing the raw Markdown: it is unambiguously the target.
  if (state.activeMarkdownEditorUri) {
    return state.activeMarkdownEditorUri;
  }
  // b. Our interactive preview panel owns a source document: follow it.
  if (state.panelSourceUri) {
    return state.panelSourceUri;
  }
  // c. VS Code's built-in preview is the active tab but exposes no source uri;
  //    resolve the backing document from the still-loaded Markdown documents.
  if (state.builtInPreviewActive) {
    const open = Array.isArray(state.openMarkdownUris) ? state.openMarkdownUris : [];
    // Avoid churn: if the current target is still a loaded Markdown document,
    // keep it rather than re-deriving (which could thrash between candidates).
    if (state.currentTargetUri && open.indexOf(state.currentTargetUri) !== -1) {
      return state.currentTargetUri;
    }
    // The common case: a single Markdown document is loaded, so it must be the
    // one the preview is rendering. THIS resolves the reported blank-sidebar bug.
    if (open.length === 1) {
      return open[0];
    }
    // Multiple candidates: disambiguate via the preview tab label, which VS Code
    // derives from the source file name (e.g. "Preview <basename>").
    if (state.previewTabLabel) {
      const label = state.previewTabLabel.toLowerCase();
      const matches = open.filter((uri) => {
        const base = basenameOf(uri).toLowerCase();
        return base.length > 0 && label.indexOf(base) !== -1;
      });
      if (matches.length === 1) {
        return matches[0];
      }
      return null;
    }
    return null;
  }
  // d. Nothing relevant is focused (e.g. an unrelated/non-Markdown tab). Keep the
  //    current target rather than blanking the sidebar — preserves prior behavior.
  return null;
}

module.exports = { chooseSidebarTarget };
