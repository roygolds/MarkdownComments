// Pure routing decision for a sidebar comment click. Kept as dependency-free
// JavaScript (no vscode imports) so it can be unit-tested directly with the fast
// mocha runner, while the extension imports it through revealRouting.d.ts.
//
// The decision answers: when the user clicks a comment card, which surface should
// receive the reveal? It must reflect what the user is ACTUALLY looking at, not
// merely whether a preview tab exists somewhere — a leftover built-in preview in
// another tab group must not hijack a click made while editing the raw source.
"use strict";

/**
 * @param {{
 *   panelHandled: boolean,        // the interactive preview panel took the reveal
 *   builtInPreviewActive: boolean,// VS Code's built-in preview is the active tab
 *   sourceEditorActive: boolean,  // the active editor is the Markdown source
 *   builtInPreviewOpen: boolean   // a built-in preview tab exists somewhere
 * }} state
 * @returns {"panel" | "preview" | "source"}
 */
function chooseRevealTarget(state) {
  if (state.panelHandled) {
    return "panel";
  }
  // The built-in preview is the focused surface for this document: drive it.
  if (state.builtInPreviewActive) {
    return "preview";
  }
  // The user is editing the raw Markdown: always reveal the source, even if a
  // stale built-in preview tab still lingers in another group.
  if (state.sourceEditorActive) {
    return "source";
  }
  // Neither the source nor the preview is focused (e.g. the click came from the
  // sidebar view). Prefer the preview only when one is actually open; otherwise
  // fall back to revealing the source.
  if (state.builtInPreviewOpen) {
    return "preview";
  }
  return "source";
}

module.exports = { chooseRevealTarget };
