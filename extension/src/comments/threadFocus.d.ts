// Type surface for threadFocus.js (authored as dependency-free JS so the unit
// tests can require it without TypeScript compilation). Mirrors the
// preview/*.d.ts convention (e.g. customPreviewTarget.d.ts).

/** A thread's inclusive display span, in 0-based editor line numbers. */
export interface FocusSpan {
  startLine: number;
  endLine: number;
}

/**
 * Resolve which thread should be focused (its inline window expanded) given the
 * cursor line. Returns the index of the smallest-span entry whose inclusive
 * [startLine, endLine] contains `cursorLine`, or -1 if none match. `null`
 * entries are skipped; size ties keep the first in order.
 */
export function focusedThreadIndex(spans: Array<FocusSpan | null>, cursorLine: number): number;
