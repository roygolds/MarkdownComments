// Shared HTML rendering for comment threads, used by both the built-in
// Markdown preview (markdown-it plugin) and the dedicated interactive panel.
//
// SECURITY: every value that originates from the (untrusted) document is passed
// through `escapeHtml` before being placed into element text OR an attribute.
// No document-derived value is ever interpolated into a <script> or a style.
// Styling lives in CSS (media/preview.css and media/panel.css); this module
// emits only class names and `data-` attributes so the same markup can be
// driven by either preview's script.

import type { ThreadView } from "../core/types";

/** Escape a string for safe use in HTML text and double-quoted attributes. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface RenderOptions {
  /** When true, emit action buttons (reply/edit/resolve/delete) for the panel. */
  interactive: boolean;
}

/** Render the threads of one fence into a comment-card container. */
export function renderThreadsHtml(
  threads: ThreadView[],
  rawPayload: string,
  opts: RenderOptions
): string {
  if (threads.length === 0) {
    return invalidBlock(rawPayload);
  }
  const cards = threads.map((t) => renderThread(t, opts)).join("");
  return (
    '<div class="markdown-comments" data-mdc="root">' +
    '<div class="markdown-comments__label">\u{1F4AC} Comments</div>' +
    cards +
    "</div>"
  );
}

function renderThread(t: ThreadView, opts: RenderOptions): string {
  const resolved = t.status === "resolved";
  const status = resolved ? "resolved" : "open";
  const header =
    '<div class="mdc-thread__header">' +
    '<button type="button" class="mdc-collapse" data-action="collapse" aria-label="Collapse thread">\u25BE</button>' +
    `<span class="mdc-thread__id">${escapeHtml(t.id)}</span>` +
    `<span class="mdc-badge mdc-badge--${status}">${status}</span>` +
    (opts.interactive ? threadActions(resolved) : "") +
    "</div>";

  let quote = "";
  if (t.quote) {
    quote = `<div class="mdc-quote">\u201C${escapeHtml(t.quote)}\u201D</div>`;
  } else if (t.anchor.kind === "needsReattach") {
    quote = '<div class="mdc-quote mdc-quote--missing">needs reattach</div>';
  }

  const comments = t.comments.map((c, i) => renderComment(c.by, c.at, c.text, i, opts)).join("");
  const reply = opts.interactive ? replyAffordance() : "";

  return (
    `<div class="mdc-thread" data-thread-id="${escapeHtml(t.id)}" data-status="${status}">` +
    header +
    '<div class="mdc-thread__body">' +
    quote +
    comments +
    reply +
    "</div>" +
    "</div>"
  );
}

function threadActions(resolved: boolean): string {
  const toggle = resolved
    ? '<button type="button" class="mdc-btn" data-action="reopen">Reopen</button>'
    : '<button type="button" class="mdc-btn" data-action="resolve">Resolve</button>';
  return (
    '<span class="mdc-thread__actions">' +
    toggle +
    '<button type="button" class="mdc-btn mdc-btn--danger" data-action="delete-thread">Delete</button>' +
    "</span>"
  );
}

function renderComment(
  by: string,
  at: string,
  text: string,
  index: number,
  opts: RenderOptions
): string {
  const actions = opts.interactive
    ? '<span class="mdc-comment__actions">' +
      `<button type="button" class="mdc-btn" data-action="edit" data-comment-index="${index}">Edit</button>` +
      `<button type="button" class="mdc-btn mdc-btn--danger" data-action="delete-comment" data-comment-index="${index}">Delete</button>` +
      "</span>"
    : "";
  return (
    `<div class="mdc-comment" data-comment-index="${index}">` +
    '<div class="mdc-comment__meta">' +
    `<span class="mdc-comment__by">${escapeHtml(by)}</span> \u00B7 ` +
    `<span class="mdc-comment__at">${escapeHtml(at)}</span>` +
    actions +
    "</div>" +
    `<div class="mdc-comment__text">${escapeHtml(text)}</div>` +
    "</div>"
  );
}

function replyAffordance(): string {
  return (
    '<div class="mdc-reply">' +
    '<button type="button" class="mdc-btn mdc-btn--reply" data-action="reply">Reply\u2026</button>' +
    "</div>"
  );
}

function invalidBlock(raw: string): string {
  return (
    '<div class="markdown-comments markdown-comments--invalid">' +
    "<strong>MarkdownComments</strong>" +
    `<pre class="mdc-raw">${escapeHtml(raw)}</pre>` +
    "</div>"
  );
}
