// Pure helper for the source-editor comment threads' "focus" behavior. Kept as
// dependency-free JavaScript (no vscode imports) so it can be unit-tested with
// the fast mocha runner, while the extension imports it through
// threadFocus.d.ts. Mirrors the preview/*.js + .d.ts sibling convention.
//
// WHY THIS EXISTS: All source-mode comment threads render collapsed by default;
// the inline "snap window" opens ONLY for the single thread whose anchor range
// contains the editor's cursor line. When ranges overlap or share a line, the
// thread with the SMALLEST line-span wins, with ties broken to the first in
// order. This precedence decision is extracted here as a pure function so it can
// be covered exhaustively without a VS Code host.
"use strict";

/**
 * @param {Array<{ startLine: number, endLine: number } | null>} spans
 *   Display spans per thread, in thread order. `null` entries are skipped.
 * @param {number} cursorLine The editor's active cursor line (0-based).
 * @returns {number} Index of the smallest-span entry whose inclusive
 *   [startLine, endLine] contains `cursorLine`, or -1 if none match.
 */
function focusedThreadIndex(spans, cursorLine) {
  let best = -1;
  let bestSize = Infinity;
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (!s) continue;
    if (cursorLine < s.startLine || cursorLine > s.endLine) continue;
    const size = s.endLine - s.startLine;
    if (size < bestSize) {
      bestSize = size;
      best = i;
    }
  }
  return best;
}

module.exports = { focusedThreadIndex };
