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
 * Open the document for `uri`, select the thread's anchored line, and scroll it
 * into view. No-ops when the uri or thread id cannot be resolved.
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
  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false
  });
  editor.selection = new vscode.Selection(vsRange.start, vsRange.start);
  editor.revealRange(vsRange, vscode.TextEditorRevealType.InCenter);
}
