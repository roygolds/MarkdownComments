// Type surface for sidebarTarget.js (authored as dependency-free JS so the unit
// tests can require it without TypeScript compilation). Mirrors revealRouting.d.ts.

export interface SidebarTargetState {
  /** Active text editor uri IFF the active editor is the Markdown source, else null. */
  activeMarkdownEditorUri: string | null;
  /** Source uri of our interactive preview panel, or null. */
  panelSourceUri: string | null;
  /** VS Code's built-in Markdown preview is the active tab. */
  builtInPreviewActive: boolean;
  /** Uris of the currently loaded Markdown TextDocuments. */
  openMarkdownUris: string[];
  /** The active tab label when the built-in preview is active (for disambiguation), else null. */
  previewTabLabel: string | null;
  /** The sidebar's existing target uri, or null. */
  currentTargetUri: string | null;
}

/**
 * Decide which document uri the comments sidebar should target. Returns null to
 * mean "keep the current target (no change)".
 */
export function chooseSidebarTarget(state: SidebarTargetState): string | null;
