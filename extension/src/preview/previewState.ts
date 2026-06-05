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

export function isSidebarVisible(): boolean {
  return sidebarVisible;
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
