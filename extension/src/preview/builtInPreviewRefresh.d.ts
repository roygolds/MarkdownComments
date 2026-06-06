// Type surface for builtInPreviewRefresh.js (authored as dependency-free JS so the
// unit tests can require it without TypeScript compilation). Mirrors
// activeTabKind.d.ts / sidebarTarget.d.ts / customPreviewTarget.d.ts.

/** A marshaled description of a tab input, for the custom-preview predicate. */
export interface PreviewTabDescriptor {
  /** Which kind of tab input this is. */
  kind?: "text" | "webview" | "custom" | "notebook" | "none" | "other" | null;
  /** For "webview"/"custom": the tab input's viewType. */
  viewType?: string | null;
}

/**
 * Whether `desc` is the built-in Markdown preview surfacing as a CUSTOM editor
 * (TabInputCustom whose viewType contains "markdown.preview"). Custom-editor
 * only: a webview preview returns false. Used by isCustomEditorPreviewOpen().
 */
export function isCustomMarkdownPreviewTabInput(desc: PreviewTabDescriptor): boolean;

/** Inputs to the refresh-command decision. */
export interface RefreshCommandState {
  /** Whether a custom-editor markdown preview is currently open. */
  customPreviewOpen: boolean;
  /** Whether the host exposes "markdown.preview.refresh". */
  hasRefresh: boolean;
  /** Whether the host exposes "markdown.api.reloadPlugins". */
  hasReloadPlugins: boolean;
}

/**
 * Decide which best-effort markdown-refresh commands refreshBuiltInPreview()
 * should run, in execution order (possibly empty).
 */
export function chooseRefreshCommands(state: RefreshCommandState): string[];
