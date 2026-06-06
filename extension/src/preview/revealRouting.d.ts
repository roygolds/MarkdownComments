// Type surface for revealRouting.js (authored as dependency-free JS so the unit
// tests can require it without TypeScript compilation).

export type RevealTarget = "panel" | "preview" | "source";

export interface RevealRoutingState {
  /** The interactive preview panel already handled the reveal. */
  panelHandled: boolean;
  /** VS Code's built-in Markdown preview is the active tab. */
  builtInPreviewActive: boolean;
  /** The active text editor is the Markdown source for the target document. */
  sourceEditorActive: boolean;
  /** A built-in Markdown preview tab exists somewhere (any group). */
  builtInPreviewOpen: boolean;
}

export function chooseRevealTarget(state: RevealRoutingState): RevealTarget;
