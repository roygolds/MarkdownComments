// Pure, side-effect-free logic for the comments preview panel: validating
// inbound webview messages, deciding whether an edit may proceed against the
// current document, and mapping a validated message to a core EditResult.
//
// Keeping these pure (no `vscode`, no I/O) makes the panel's highest-risk glue
// — the hostile-input firewall, the stale-edit guard, and the core argument
// wiring — directly unit-testable.

import type { EditResult } from "../core/types";

export const MAX_BODY_LENGTH = 100_000;
export const MAX_THREAD_ID_LENGTH = 200;
export const MAX_URI_LENGTH = 4096;
export const MAX_COMMENT_INDEX = 100_000;

export type Inbound =
  | { type: "reply"; threadId: string; body: string; docVersion: number; uri: string }
  | {
      type: "edit";
      threadId: string;
      commentIndex: number;
      newText: string;
      docVersion: number;
      uri: string;
    }
  | { type: "resolve"; threadId: string; docVersion: number; uri: string }
  | { type: "reopen"; threadId: string; docVersion: number; uri: string }
  | { type: "deleteThread"; threadId: string; docVersion: number; uri: string }
  | {
      type: "deleteComment";
      threadId: string;
      commentIndex: number;
      docVersion: number;
      uri: string;
    };

const KNOWN_TYPES = new Set([
  "reply",
  "edit",
  "resolve",
  "reopen",
  "deleteThread",
  "deleteComment"
]);

function isBoundedString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_BODY_LENGTH;
}

function isCommentIndex(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < MAX_COMMENT_INDEX;
}

/** Validate an untrusted webview message, returning a typed Inbound or undefined. */
export function validateInboundMessage(raw: unknown): Inbound | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.type !== "string" || !KNOWN_TYPES.has(r.type)) {
    return undefined;
  }
  if (typeof r.docVersion !== "number" || !Number.isInteger(r.docVersion)) {
    return undefined;
  }
  if (typeof r.uri !== "string" || r.uri.length === 0 || r.uri.length > MAX_URI_LENGTH) {
    return undefined;
  }
  if (
    typeof r.threadId !== "string" ||
    r.threadId.length === 0 ||
    r.threadId.length > MAX_THREAD_ID_LENGTH
  ) {
    return undefined;
  }
  const base = { threadId: r.threadId, docVersion: r.docVersion, uri: r.uri };

  switch (r.type) {
    case "reply": {
      if (!isBoundedString(r.body)) {
        return undefined;
      }
      return { type: "reply", body: r.body, ...base };
    }
    case "edit": {
      if (!isCommentIndex(r.commentIndex) || !isBoundedString(r.newText)) {
        return undefined;
      }
      return { type: "edit", commentIndex: r.commentIndex, newText: r.newText, ...base };
    }
    case "deleteComment": {
      if (!isCommentIndex(r.commentIndex)) {
        return undefined;
      }
      return { type: "deleteComment", commentIndex: r.commentIndex, ...base };
    }
    case "resolve":
      return { type: "resolve", ...base };
    case "reopen":
      return { type: "reopen", ...base };
    case "deleteThread":
      return { type: "deleteThread", ...base };
    default:
      return undefined;
  }
}

export type GuardDecision = "ok" | "wrongUri" | "noDocument" | "staleVersion";

/**
 * Decide whether a message may be applied to the current document. Called again
 * after every async boundary, so a concurrent external edit (which bumps the
 * document version) is caught before any positional edit is computed.
 */
export function evaluateLiveGuard(p: {
  msgUri: string;
  panelUri: string;
  doc: { version: number } | undefined;
  msgVersion: number;
}): GuardDecision {
  if (p.msgUri !== p.panelUri) {
    return "wrongUri";
  }
  if (!p.doc) {
    return "noDocument";
  }
  if (p.doc.version !== p.msgVersion) {
    return "staleVersion";
  }
  return "ok";
}

export interface CoreOps {
  addReply(text: string, threadId: string, by: string, at: string, body: string): EditResult;
  editComment(text: string, threadId: string, commentIndex: number, newText: string): EditResult;
  setThreadStatus(
    text: string,
    threadId: string,
    resolved: boolean,
    by: string | undefined,
    at: string | undefined
  ): EditResult;
  deleteThread(text: string, threadId: string): EditResult;
  deleteComment(text: string, threadId: string, commentIndex: number): EditResult;
}

export interface Identity {
  by?: string;
  at?: string;
}

/**
 * Map a validated message to a core EditResult against `text`. Identity (author
 * name and timestamp) is injected for the operations that record it. This does
 * not apply the edit — callers apply the returned EditResult.
 */
export function computeEdit(
  core: CoreOps,
  text: string,
  msg: Inbound,
  identity: Identity
): EditResult {
  switch (msg.type) {
    case "reply":
      return core.addReply(text, msg.threadId, identity.by ?? "", identity.at ?? "", msg.body);
    case "edit":
      return core.editComment(text, msg.threadId, msg.commentIndex, msg.newText);
    case "resolve":
      return core.setThreadStatus(text, msg.threadId, true, identity.by, identity.at);
    case "reopen":
      return core.setThreadStatus(text, msg.threadId, false, undefined, undefined);
    case "deleteComment":
      return core.deleteComment(text, msg.threadId, msg.commentIndex);
    case "deleteThread":
      return core.deleteThread(text, msg.threadId);
  }
}

/** True for the operations that must record an author and timestamp. */
export function needsIdentity(type: Inbound["type"]): boolean {
  return type === "reply" || type === "resolve";
}
