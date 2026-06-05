// Click-to-reveal: when a comment card is clicked in the sidebar or the
// interactive panel, jump to the anchored line in the Markdown document. The
// anchor range comes from the same pure core that renders the cards, so the
// reveal target always matches what the user sees.

import * as vscode from "vscode";
import { core } from "../core/wasmBridge";
import type { Range as CoreRange } from "../core/types";

const MAX_THREAD_ID = 200;
const MAX_URI = 4096;

export interface RevealMessage {
  type: "reveal";
  threadId: string;
  uri: string;
}

/**
 * Validate an inbound webview message as a reveal request. Returns the typed
 * message or undefined. Mirrors the defensive validation used for edit messages,
 * including the originating document `uri` so the handler can reject a stale
 * click that no longer matches the surface's current target.
 */
export function parseRevealMessage(raw: unknown): RevealMessage | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const msg = raw as Record<string, unknown>;
  if (msg.type !== "reveal") {
    return undefined;
  }
  if (typeof msg.threadId !== "string" || msg.threadId.length === 0 || msg.threadId.length > MAX_THREAD_ID) {
    return undefined;
  }
  if (typeof msg.uri !== "string" || msg.uri.length === 0 || msg.uri.length > MAX_URI) {
    return undefined;
  }
  return { type: "reveal", threadId: msg.threadId, uri: msg.uri };
}

/**
 * Find the best reveal range for a thread: the resolved anchor of the commented
 * content when available, falling back to the target block and finally the
 * comment fence itself (so a thread whose anchor needs reattachment still jumps
 * to its comment block). Returns undefined only when the thread id is unknown.
 */
export function findThreadRange(text: string, threadId: string): CoreRange | undefined {
  let fences;
  try {
    fences = core.parse(text).fences;
  } catch {
    return undefined;
  }
  for (const fence of fences) {
    for (const thread of fence.threads) {
      if (thread.id === threadId) {
        return thread.anchor.range ?? fence.target.range ?? fence.range;
      }
    }
  }
  return undefined;
}

function toVsRange(r: CoreRange): vscode.Range {
  return new vscode.Range(
    r.start.line,
    r.start.character,
    r.end.line,
    r.end.character
  );
}

/**
 * Whether the active tab is VS Code's built-in Markdown preview. Its webview
 * viewType is "mainThreadWebview-markdown.preview"; matching the dotted
 * "markdown.preview" token avoids also matching our own panel, whose viewType is
 * "markdownCommentsPreview" (no dot). When true, a reveal should avoid stealing
 * keyboard focus away from that preview and should instead drive its scroll-sync.
 */
function isBuiltInPreviewActive(): boolean {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = tab?.input;
  if (input instanceof vscode.TabInputWebview) {
    return input.viewType.toLowerCase().includes("markdown.preview");
  }
  return false;
}

/**
 * Reveal the thread's anchored line in the Markdown document. Behaviour depends
 * on what the user is looking at:
 *
 * - If a text editor for the document is already visible, scroll/select the line
 *   there without changing focus. When that editor is synced with VS Code's
 *   built-in Markdown preview (scroll-sync is on by default), the preview scrolls
 *   to the same line — so clicking a sidebar comment "focuses" the preview.
 * - Otherwise open the editor. When the built-in preview is the active tab we open
 *   beside it with focus preserved (so the preview stays put and scroll-syncs to
 *   the line); when the user is in the raw editor we focus it as before.
 *
 * VS Code exposes no API to scroll the built-in preview directly, so this relies
 * on editor->preview scroll-sync; if the user disabled
 * `markdown.preview.scrollPreviewWithEditor` the preview will not follow.
 *
 * No-ops when the uri or thread id cannot be resolved.
 */
export async function revealThread(
  uri: vscode.Uri | undefined,
  threadId: string
): Promise<void> {
  if (!uri) {
    return;
  }
  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument(uri);
  } catch {
    return;
  }
  const range = findThreadRange(document.getText(), threadId);
  if (!range) {
    return;
  }
  const vsRange = toVsRange(range);
  const selection = new vscode.Selection(vsRange.start, vsRange.start);
  const previewActive = isBuiltInPreviewActive();
  // The built-in preview syncs to the editor's TOP visible line, so align the
  // anchored line to the top when a preview is driving; otherwise center it.
  const revealType = previewActive
    ? vscode.TextEditorRevealType.AtTop
    : vscode.TextEditorRevealType.InCenter;

  const visible = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === uri.toString()
  );
  if (visible) {
    // Scroll/select in place; if a synced preview is showing, it follows along.
    visible.selection = selection;
    visible.revealRange(vsRange, revealType);
    return;
  }

  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: previewActive,
    viewColumn: previewActive ? vscode.ViewColumn.Beside : undefined
  });
  editor.selection = selection;
  editor.revealRange(vsRange, revealType);
}
