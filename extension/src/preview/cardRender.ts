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

// Inline SVG icons for action buttons. Embedded directly in the HTML string so
// they work under the strict, nonce-gated CSP (no external fonts/images). The
// icons use `currentColor` so they inherit the button's text color (e.g. the
// danger red for delete) and are hidden from screen readers — the button's
// `aria-label` carries the accessible name.
const PEN_ICON =
  '<svg class="mdc-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M12.146 1.146a.5.5 0 0 1 .708 0l2 2a.5.5 0 0 1 0 .708l-9 9a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.632-.633l1-3a.5.5 0 0 1 .11-.168l9-9Zm.354 1.06L11.207 3.5 12.5 4.793 13.793 3.5 12.5 2.207ZM11.793 5.5 10.5 4.207l-6.5 6.5V11h.5v.5h.5v.5h.293l6.5-6.5Z"/>' +
  '</svg>';
const TRASH_ICON =
  '<svg class="mdc-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M6.5 1a1 1 0 0 0-1 1v1H2.5a.5.5 0 0 0 0 1h.55l.8 9.6A1.5 1.5 0 0 0 5.34 15h5.32a1.5 1.5 0 0 0 1.49-1.4L12.95 4h.55a.5.5 0 0 0 0-1H10.5V2a1 1 0 0 0-1-1h-3Zm0 1h3v1h-3V2ZM4.05 4h7.9l-.79 9.52a.5.5 0 0 1-.5.48H5.34a.5.5 0 0 1-.5-.48L4.05 4Zm2.45 1.5a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 1 0V6a.5.5 0 0 0-.5-.5Zm3 0a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 1 0V6a.5.5 0 0 0-.5-.5Z"/>' +
  '</svg>';

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
  /** When false, omit the per-fence "Comments" label (used by the sidebar). */
  label?: boolean;
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
  const label =
    opts.label === false
      ? ""
      : '<div class="markdown-comments__label">\u{1F4AC} Comments</div>';
  return '<div class="markdown-comments" data-mdc="root">' + label + cards + "</div>";
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
    '<button type="button" class="mdc-btn mdc-btn--icon mdc-btn--danger" data-action="delete-thread" title="Delete thread" aria-label="Delete thread">' +
    TRASH_ICON +
    "</button>" +
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
      `<button type="button" class="mdc-btn mdc-btn--icon" data-action="edit" data-comment-index="${index}" title="Edit" aria-label="Edit">${PEN_ICON}</button>` +
      `<button type="button" class="mdc-btn mdc-btn--icon mdc-btn--danger" data-action="delete-comment" data-comment-index="${index}" title="Delete" aria-label="Delete">${TRASH_ICON}</button>` +
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
