// Pure, dependency-free helpers for the sidebar-visibility -> built-in-preview
// re-render path. Authored as plain JavaScript (no vscode imports) so the fast
// mocha unit runner can require it directly, while the extension imports it
// through builtInPreviewRefresh.d.ts. Mirrors activeTabKind.js / sidebarTarget.js.
//
// WHY THIS EXISTS (Issue 2): inline comment cards are suppressed server-side
// while the Comments sidebar is visible (markdownItPlugin.ts:
// `if (!options.interactive && isSidebarVisible()) return anchor;`), so HIDING
// the sidebar must trigger a built-in-preview re-render for the cards to
// reappear. refreshBuiltInPreview() does that, and when the built-in preview is
// surfacing as a CUSTOM editor (TabInputCustom, viewType
// "vscode.markdown.preview.editor") it fires an extra best-effort kick. Both the
// "is this tab the custom-editor markdown preview?" predicate and the "which
// refresh commands should run?" decision are extracted here so they can be unit
// tested exhaustively — the live custom-editor re-render cannot be forced in the
// headless integration host (there the preview only ever surfaces as a webview).
"use strict";

/**
 * Whether a marshaled tab-input descriptor is VS Code's built-in Markdown preview
 * surfacing as a CUSTOM editor (TabInputCustom whose viewType contains the
 * "markdown.preview" token, e.g. "vscode.markdown.preview.editor").
 *
 * This is the exact predicate isCustomEditorPreviewOpen() applies to each open
 * tab, lifted out verbatim so production keeps a single source of truth and the
 * contract is deterministically testable.
 *
 * CONTRACT (custom-editor ONLY, matching isCustomEditorPreviewOpen):
 *   - kind "custom" + viewType containing "markdown.preview" -> true (the bug's
 *     StaticMarkdownPreview variant). Match is case-insensitive.
 *   - kind "webview" -> false EVEN for a "markdown.preview" viewType. The WEBVIEW
 *     preview (DynamicMarkdownPreview) is detected elsewhere; this predicate
 *     gates only the EXTRA custom-editor-specific refresh kick.
 *   - any other custom editor (image/hex/etc.), text, notebook, none, other,
 *     or a custom tab with no/empty viewType -> false. Never throws.
 *
 * @param {{ kind?: string|null, viewType?: string|null }} desc
 * @returns {boolean}
 */
function isCustomMarkdownPreviewTabInput(desc) {
  if (!desc || desc.kind !== "custom") {
    return false;
  }
  const viewType = (desc.viewType || "").toLowerCase();
  return viewType.includes("markdown.preview");
}

/**
 * Decide which best-effort markdown-refresh commands refreshBuiltInPreview()
 * should run, given which commands the host exposes and whether a custom-editor
 * preview is open. Pure mirror of refreshBuiltInPreview()'s command-selection
 * tail so the decision is unit-testable without a live VS Code host.
 *
 * DECISION (order matters — the array preserves execution order):
 *   1. "markdown.preview.refresh" runs whenever it is available. It force-
 *      refreshes BOTH the webview and custom-editor preview variants, so it is
 *      the primary mechanism for un-suppressing the inline cards on sidebar hide.
 *   2. "markdown.api.reloadPlugins" runs ONLY when a custom-editor preview is
 *      open AND the command exists — an independent forced re-render path for the
 *      StaticMarkdownPreview variant, in case a given VS Code build wires the
 *      refresh command differently.
 *
 * @param {{
 *   customPreviewOpen: boolean,   // isCustomEditorPreviewOpen()
 *   hasRefresh: boolean,          // host exposes "markdown.preview.refresh"
 *   hasReloadPlugins: boolean     // host exposes "markdown.api.reloadPlugins"
 * }} state
 * @returns {string[]} the commands to execute, in order (possibly empty).
 */
function chooseRefreshCommands(state) {
  const ran = [];
  if (state && state.hasRefresh) {
    ran.push("markdown.preview.refresh");
  }
  if (state && state.customPreviewOpen && state.hasReloadPlugins) {
    ran.push("markdown.api.reloadPlugins");
  }
  return ran;
}

module.exports = { isCustomMarkdownPreviewTabInput, chooseRefreshCommands };
