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

// How long to wait for the editor's visible range to actually change after a
// reveal before assuming the reveal was a no-op (e.g. the target was already at
// the top). Comfortably longer than VS Code's 50ms TopmostLineMonitor throttle.
const REVEAL_EVENT_TIMEOUT_MS = 200;
// Let a nudge reveal settle (and clear the throttle window) before the final
// reveal, so the two scrolls are not coalesced into one by VS Code.
const NUDGE_SETTLE_MS = 80;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve once the visible range of an editor for `uri` changes, or after
 * `timeoutMs` with `false`. The built-in Markdown preview only scroll-syncs in
 * response to `onDidChangeTextEditorVisibleRanges` (via its TopmostLineMonitor),
 * so observing this event tells us whether a reveal actually moved the editor —
 * and therefore whether the preview had anything to follow.
 */
function waitForVisibleRangeChange(uri: vscode.Uri, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (changed: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      sub.dispose();
      clearTimeout(timer);
      resolve(changed);
    };
    const sub = vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (e.textEditor.document.uri.toString() === uri.toString()) {
        finish(true);
      }
    });
    const timer = setTimeout(() => finish(false), timeoutMs);
  });
}

/**
 * Scroll `editor` to `vsRange` in a way that reliably drives VS Code's built-in
 * Markdown preview. A single `revealRange` is a no-op when the target is already
 * the top visible line, which emits no visible-range event and leaves the preview
 * where it was. So we watch for the event and, if the first reveal moves nothing,
 * nudge the editor to a far line and reveal again — guaranteeing a real scroll the
 * preview's scroll-sync can follow.
 */
async function driveScrollSync(
  editor: vscode.TextEditor,
  vsRange: vscode.Range,
  revealType: vscode.TextEditorRevealType
): Promise<void> {
  const uri = editor.document.uri;
  let changed = waitForVisibleRangeChange(uri, REVEAL_EVENT_TIMEOUT_MS);
  editor.revealRange(vsRange, revealType);
  if (await changed) {
    return;
  }

  const targetLine = vsRange.start.line;
  const lastLine = Math.max(0, editor.document.lineCount - 1);
  const nudgeLine = targetLine === 0 ? Math.min(lastLine, 1) : 0;
  if (nudgeLine === targetLine) {
    return;
  }
  editor.revealRange(
    new vscode.Range(nudgeLine, 0, nudgeLine, 0),
    vscode.TextEditorRevealType.AtTop
  );
  await delay(NUDGE_SETTLE_MS);
  changed = waitForVisibleRangeChange(uri, REVEAL_EVENT_TIMEOUT_MS);
  editor.revealRange(vsRange, revealType);
  await changed;
}

/**
 * Reveal the thread's anchored line in the Markdown document. Behaviour depends
 * on what the user is looking at:
 *
 * - When VS Code's built-in Markdown preview is the active tab, keep keyboard
 *   focus where it is (the sidebar) and drive the preview via editor->preview
 *   scroll-sync: reuse a visible source editor if one exists, otherwise open one
 *   beside the preview with focus preserved. The reveal is event-verified so it
 *   still works when the target is already near the top (see driveScrollSync).
 * - Otherwise (the user is in the raw editor) focus the editor and center the
 *   line, as before.
 *
 * VS Code exposes no API to scroll the built-in preview directly, so this relies
 * on editor->preview scroll-sync, which requires a visible source editor and
 * `markdown.preview.scrollPreviewWithEditor` (on by default). No-ops when the uri
 * or thread id cannot be resolved.
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

  let editor = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === uri.toString()
  );
  if (!editor) {
    try {
      editor = await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: previewActive,
        viewColumn: previewActive ? vscode.ViewColumn.Beside : undefined
      });
    } catch {
      return;
    }
  }
  editor.selection = selection;

  if (previewActive) {
    // The built-in preview syncs to the editor's TOP visible line; align there
    // and make sure the scroll actually happens so the preview follows.
    await driveScrollSync(editor, vsRange, vscode.TextEditorRevealType.AtTop);
    return;
  }
  editor.revealRange(vsRange, vscode.TextEditorRevealType.InCenter);
}
