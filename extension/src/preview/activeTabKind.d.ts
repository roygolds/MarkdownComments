// Type surface for activeTabKind.js (authored as dependency-free JS so the unit
// tests can require it without TypeScript compilation). Mirrors sidebarTarget.d.ts.

/** Classification of the focused tab group's active tab. */
export type ActiveTabKind =
  | "markdownSource"
  | "markdownPreview"
  | "previewLikeWebview"
  | "nonMarkdownDoc"
  | "ambiguous";

/** A marshaled description of the focused tab group's active tab input. */
export interface ActiveTabDescriptor {
  /** Which kind of tab input is active. "none" = no active tab / no input. */
  kind: "text" | "webview" | "custom" | "notebook" | "none" | "other";
  /** For "webview"/"custom": the tab input's viewType. */
  viewType?: string | null;
  /**
   * For "custom": the tab input's backing resource uri (TabInputCustom.uri),
   * as a string. The built-in Markdown preview, when it surfaces as a custom
   * editor, exposes the previewed document's uri here. Ignored by
   * classifyActiveTab(); consumed by recomputeTarget() to target it directly.
   */
  uri?: string | null;
  /** For "text": the tab uri's scheme (e.g. "file", "untitled", "comment"). */
  uriScheme?: string | null;
  /** For "text": the loaded document's languageId, if the document is loaded. */
  languageId?: string | null;
  /** For "text": the tab uri's path (used to classify a not-yet-loaded tab). */
  path?: string | null;
}

/** Our interactive preview panel's webview viewType, lower-cased. */
export const PANEL_VIEW_TYPE: string;

/**
 * Classify the active tab described by `desc` into the model recomputeTarget()
 * uses to decide target resolution and KEEP-vs-CLEAR.
 */
export function classifyActiveTab(desc: ActiveTabDescriptor): ActiveTabKind;
