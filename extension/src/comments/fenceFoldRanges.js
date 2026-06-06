// Pure helper for source-editor folding of ```MarkdownComments fences. Kept as
// dependency-free JavaScript (no vscode imports) so it can be unit-tested with
// the fast mocha runner, while the extension imports it through
// fenceFoldRanges.d.ts. Mirrors the threadFocus.js + .d.ts sibling convention.
//
// WHY THIS EXISTS: The inline YAML metadata fences are collapsed by default in
// the Markdown SOURCE editor so the prose stays readable. Deciding WHICH fence
// spans are actually foldable (they must cover more than one line) and WHICH
// start lines to fold is a pure computation, extracted here so it can be covered
// exhaustively without a VS Code host.
"use strict";

/**
 * @param {Array<{ startLine: number, endLine: number } | null>} spans
 *   Fence spans in document order. `null` entries are skipped. Lines are 0-based.
 * @returns {Array<{ start: number, end: number }>} One region per span that
 *   covers more than a single line (`endLine > startLine`), preserving order.
 */
function fenceFoldRegions(spans) {
  const out = [];
  for (const s of spans) {
    if (!s) continue;
    if (s.endLine > s.startLine) {
      out.push({ start: s.startLine, end: s.endLine });
    }
  }
  return out;
}

/**
 * @param {Array<{ startLine: number, endLine: number } | null>} spans
 * @returns {number[]} The start line of each foldable region, in order.
 */
function fenceFoldStartLines(spans) {
  return fenceFoldRegions(spans).map((r) => r.start);
}

module.exports = { fenceFoldRegions, fenceFoldStartLines };
