// Shared UI state coordinating the comment surfaces. Currently tracks whether
// the Word-style comments sidebar is visible: when it is, inline comment cards
// are suppressed in VS Code's built-in Markdown preview so comments are shown in
// only one place (the sidebar), matching the Word/Docs side-comment experience.
//
// The interactive Comments Preview panel is intentionally NOT affected — it
// exists specifically to show and edit comments alongside the document.

type Listener = () => void;

let sidebarVisible = false;
const listeners = new Set<Listener>();

// One-shot reveal request bridged from a sidebar click to the built-in preview.
// VS Code exposes no API to scroll the built-in preview and no channel to message
// our contributed preview script directly. So a click stores the target thread id
// with a fresh nonce here; a `markdown.preview.refresh` re-renders the document
// through our markdown-it plugin, which embeds an invisible anchor carrying the
// nonce next to the matching fence; media/preview.js then scrolls that anchor into
// view. The nonce lets the preview script ignore stale markers and re-scroll when
// the same comment is clicked again.
let pendingReveal: { threadId: string; nonce: string } | undefined;

export interface PendingReveal {
  readonly threadId: string;
  readonly nonce: string;
}

export function isSidebarVisible(): boolean {
  return sidebarVisible;
}

/** Record a thread to scroll to in the built-in preview and return its nonce. */
export function setPendingReveal(threadId: string): string {
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  pendingReveal = { threadId, nonce };
  return nonce;
}

export function getPendingReveal(): PendingReveal | undefined {
  return pendingReveal;
}

export function clearPendingReveal(): void {
  pendingReveal = undefined;
}

export function setSidebarVisible(visible: boolean): void {
  if (visible === sidebarVisible) {
    return;
  }
  sidebarVisible = visible;
  for (const listener of [...listeners]) {
    listener();
  }
}

export function onSidebarVisibilityChange(listener: Listener): { dispose(): void } {
  listeners.add(listener);
  return { dispose: () => listeners.delete(listener) };
}
