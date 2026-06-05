// Renders every comment thread in a document as Word-style side cards, used by
// the comments sidebar. Unlike the preview panel, this shows ONLY the comments
// (no Markdown body). Parsing goes through the same pure core as everywhere
// else, and all content is HTML-escaped by the shared card renderer.

import { core } from "../core/wasmBridge";
import type { FenceView, Range as CoreRange } from "../core/types";
import { renderThreadsHtml, escapeHtml } from "./cardRender";

function offsetAt(text: string, line: number, character: number): number {
  const lines = text.split("\n");
  let off = 0;
  for (let i = 0; i < line && i < lines.length; i++) {
    off += lines[i].length + 1;
  }
  return off + character;
}

function sliceRange(text: string, range: CoreRange): string {
  const start = offsetAt(text, range.start.line, range.start.character);
  const end = offsetAt(text, range.end.line, range.end.character);
  return text.slice(start, end);
}

/** Best-effort extraction of a fence's YAML payload for the invalid-block view. */
function fencePayload(text: string, fence: FenceView): string {
  const block = sliceRange(text, fence.range);
  const lines = block.split("\n");
  if (lines.length <= 2) {
    return block;
  }
  // Drop the opening ```MarkdownComments line and the closing ``` line.
  return lines.slice(1, lines.length - 1).join("\n");
}

/**
 * Render all comment threads in `text` as interactive cards. Returns an
 * empty-state message when the document has no comment fences.
 */
export function renderDocumentComments(text: string): string {
  let fences: FenceView[];
  try {
    fences = core.parse(text).fences;
  } catch {
    return emptyState("Unable to read comments in this document.");
  }
  if (fences.length === 0) {
    return emptyState("No comments in this document yet.");
  }
  return fences
    .map((fence) =>
      renderThreadsHtml(fence.threads, fencePayload(text, fence), {
        interactive: true,
        label: false
      })
    )
    .join("");
}

function emptyState(message: string): string {
  return `<p class="mdc-sidebar__empty">${escapeHtml(message)}</p>`;
}

/**
 * Pure selection of the sidebar body for its three states: no active Markdown
 * target, a target whose document is not open in an editor, or the rendered
 * comment cards. Kept separate from the provider so the branch can be unit
 * tested without a webview.
 */
export function selectSidebarBody(
  hasTarget: boolean,
  documentText: string | undefined
): string {
  if (!hasTarget) {
    return emptyState("Open a Markdown file to see its comments.");
  }
  if (documentText === undefined) {
    return emptyState("Open the document in an editor to view its comments.");
  }
  return renderDocumentComments(documentText);
}
