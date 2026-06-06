// Pure classification of the focused tab group's active tab into the model the
// comments sidebar's recomputeTarget() uses to drive target resolution and the
// KEEP-vs-CLEAR decision. Kept as dependency-free JavaScript (no vscode imports)
// so it can be unit-tested directly with the fast mocha runner, while the
// extension imports it through activeTabKind.d.ts. This mirrors sidebarTarget.js.
//
// REGRESSION THIS GUARDS: VS Code's built-in Markdown preview does NOT always
// surface as a webview. On some builds / when the "Markdown preview editor" is
// used, it surfaces in the tabs API as a CUSTOM editor (TabInputCustom) whose
// viewType is "vscode.markdown.preview.editor" — which contains the
// "markdown.preview" token but is NOT a TabInputWebview. Detection that only
// matched TabInputWebview classified the active preview as something else, so the
// recompute model CLEARED the sidebar and it went blank while the preview was up.
// classifyActiveTab() recognizes the custom-editor preview as "markdownPreview"
// so the sidebar keeps following the backing Markdown instead of blanking.
"use strict";

// Our interactive preview panel's webview viewType (see previewPanel.ts), lower-
// cased for tab classification. A webview tab whose viewType contains this token
// is our own panel, which is a Markdown preview surface like the built-in one.
const PANEL_VIEW_TYPE = "markdowncommentspreview";

/**
 * Classify a marshaled description of the focused tab group's active tab.
 *
 * Behaviour (identical to the provider's former inline activeTabKind()):
 * - kind "none"                       -> "ambiguous"  (no active tab / no input)
 * - kind "text", file/untitled scheme -> "markdownSource" when the doc is markdown
 *                                        (by loaded languageId, or .md path when
 *                                        not yet loaded), else "nonMarkdownDoc"
 * - kind "text", any other scheme     -> "ambiguous"  (comment:, output:, git:, …;
 *                                        reading logs must NOT clear the sidebar)
 * - kind "webview", markdown.preview or our panel viewType -> "markdownPreview"
 * - kind "webview", anything else      -> "previewLikeWebview" (an unrecognized
 *                                         webview is almost certainly the built-in
 *                                         preview whose viewType we failed to match)
 * - kind "custom", markdown.preview viewType -> "markdownPreview" (THE built-in
 *                                         preview-as-custom-editor regression)
 * - kind "custom", anything else       -> "nonMarkdownDoc" (a different document)
 * - kind "notebook"                    -> "nonMarkdownDoc"
 * - anything else                      -> "ambiguous"
 *
 * @param {{
 *   kind: "text"|"webview"|"custom"|"notebook"|"none"|"other",
 *   viewType?: string|null,   // webview/custom: the tab input's viewType
 *   uriScheme?: string|null,  // text: the tab uri's scheme
 *   languageId?: string|null, // text: the loaded document's languageId, if loaded
 *   path?: string|null        // text: the tab uri's path (used when not yet loaded)
 * }} desc
 * @returns {"markdownSource"|"markdownPreview"|"previewLikeWebview"|"nonMarkdownDoc"|"ambiguous"}
 */
function classifyActiveTab(desc) {
  if (!desc || desc.kind == null || desc.kind === "none") {
    return "ambiguous";
  }
  switch (desc.kind) {
    case "text": {
      const scheme = desc.uriScheme;
      if (scheme === "file" || scheme === "untitled") {
        if (typeof desc.languageId === "string") {
          // The document is loaded: trust its resolved languageId.
          return desc.languageId === "markdown" ? "markdownSource" : "nonMarkdownDoc";
        }
        // Not yet loaded as a TextDocument: classify by extension so a still-
        // loading .md tab is markdown rather than treated as another document.
        const path = typeof desc.path === "string" ? desc.path : "";
        return path.toLowerCase().endsWith(".md") ? "markdownSource" : "nonMarkdownDoc";
      }
      // Other schemes (comment:, output:, git:, vscode-userdata:, …) are not user
      // content docs; reading logs in the Output panel must NOT clear the sidebar.
      return "ambiguous";
    }
    case "webview": {
      const viewType = (desc.viewType || "").toLowerCase();
      if (viewType.includes("markdown.preview") || viewType.includes(PANEL_VIEW_TYPE)) {
        return "markdownPreview";
      }
      // Unrecognized webview: almost certainly the built-in preview whose viewType
      // we failed to match — treat as preview-like so the sidebar still follows it.
      return "previewLikeWebview";
    }
    case "custom": {
      // VS Code's built-in Markdown preview can surface as a CUSTOM editor, not a
      // webview: TabInputCustom with viewType "vscode.markdown.preview.editor"
      // (which contains the "markdown.preview" token). Recognize it as the preview
      // so the sidebar follows it; any other custom editor is a different document.
      const viewType = (desc.viewType || "").toLowerCase();
      if (viewType.includes("markdown.preview")) {
        return "markdownPreview";
      }
      return "nonMarkdownDoc";
    }
    case "notebook":
      return "nonMarkdownDoc";
    default:
      return "ambiguous";
  }
}

module.exports = { classifyActiveTab, PANEL_VIEW_TYPE };
