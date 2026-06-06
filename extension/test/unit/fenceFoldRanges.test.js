// Unit tests for fenceFoldRegions / fenceFoldStartLines, the pure helpers that
// decide which ```MarkdownComments fences are foldable in the source editor and
// at which start lines to fold them.
// Run with: npm run test:unit
//
// Background: Inline-YAML fences are collapsed by default so the prose stays
// readable. Only fences that cover more than a single line are foldable;
// single-line spans and `null` entries are skipped, and document order is
// preserved. The decision is pure, so it is covered exhaustively here without a
// VS Code host.

const assert = require("assert");
const path = require("path");
const { fenceFoldRegions, fenceFoldStartLines } = require(
  path.join(__dirname, "..", "..", "src", "comments", "fenceFoldRanges.js")
);

describe("fenceFoldRegions", () => {
  it("returns an empty array for empty input", () => {
    assert.deepStrictEqual(fenceFoldRegions([]), []);
  });

  it("maps a normal multi-line fence to one region with correct start/end", () => {
    const spans = [{ startLine: 2, endLine: 10 }];
    assert.deepStrictEqual(fenceFoldRegions(spans), [{ start: 2, end: 10 }]);
  });

  it("skips a single-line span (endLine === startLine)", () => {
    const spans = [{ startLine: 4, endLine: 4 }];
    assert.deepStrictEqual(fenceFoldRegions(spans), []);
  });

  it("skips null entries", () => {
    const spans = [null, { startLine: 1, endLine: 3 }, null];
    assert.deepStrictEqual(fenceFoldRegions(spans), [{ start: 1, end: 3 }]);
  });

  it("preserves order across multiple fences and drops non-foldable ones", () => {
    const spans = [
      { startLine: 0, endLine: 5 },
      { startLine: 7, endLine: 7 }, // single-line, dropped
      null,
      { startLine: 9, endLine: 12 }
    ];
    assert.deepStrictEqual(fenceFoldRegions(spans), [
      { start: 0, end: 5 },
      { start: 9, end: 12 }
    ]);
  });
});

describe("fenceFoldStartLines", () => {
  it("returns an empty array for empty input", () => {
    assert.deepStrictEqual(fenceFoldStartLines([]), []);
  });

  it("returns the start line of a single foldable fence", () => {
    assert.deepStrictEqual(fenceFoldStartLines([{ startLine: 2, endLine: 10 }]), [2]);
  });

  it("skips single-line spans and null entries", () => {
    const spans = [null, { startLine: 4, endLine: 4 }, { startLine: 6, endLine: 8 }];
    assert.deepStrictEqual(fenceFoldStartLines(spans), [6]);
  });

  it("preserves order across multiple foldable fences", () => {
    const spans = [
      { startLine: 0, endLine: 5 },
      { startLine: 7, endLine: 7 },
      { startLine: 9, endLine: 12 }
    ];
    assert.deepStrictEqual(fenceFoldStartLines(spans), [0, 9]);
  });
});
