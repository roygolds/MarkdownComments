// Unit tests for focusedThreadIndex, the precedence helper that decides which
// source-editor comment thread's inline window opens for a given cursor line.
// Run with: npm run test:unit
//
// Background: All source-mode threads render collapsed; exactly one — the thread
// whose inclusive display span contains the cursor line — may expand. Overlaps
// resolve to the SMALLEST line-span, ties break to the first in order, and
// `null` spans (threads without a range) are skipped. The decision is pure, so
// it is covered exhaustively here without a VS Code host.

const assert = require("assert");
const path = require("path");
const { focusedThreadIndex } = require(
  path.join(__dirname, "..", "..", "src", "comments", "threadFocus.js")
);

describe("focusedThreadIndex", () => {
  it("returns -1 for an empty array", () => {
    assert.strictEqual(focusedThreadIndex([], 0), -1);
  });

  it("returns -1 when the cursor is outside every span", () => {
    const spans = [
      { startLine: 2, endLine: 4 },
      { startLine: 10, endLine: 12 }
    ];
    assert.strictEqual(focusedThreadIndex(spans, 7), -1);
  });

  it("returns the index of the single containing span", () => {
    const spans = [
      { startLine: 0, endLine: 1 },
      { startLine: 5, endLine: 8 },
      { startLine: 20, endLine: 22 }
    ];
    assert.strictEqual(focusedThreadIndex(spans, 6), 1);
  });

  it("prefers the smallest span when spans overlap", () => {
    const spans = [
      { startLine: 0, endLine: 100 }, // size 100
      { startLine: 4, endLine: 6 }, // size 2 (smallest, contains 5)
      { startLine: 3, endLine: 9 } // size 6
    ];
    assert.strictEqual(focusedThreadIndex(spans, 5), 1);
  });

  it("breaks equal-size ties to the first matching span", () => {
    const spans = [
      { startLine: 4, endLine: 6 }, // size 2, contains 5
      { startLine: 5, endLine: 7 } // size 2, contains 5
    ];
    assert.strictEqual(focusedThreadIndex(spans, 5), 0);
  });

  it("skips null entries", () => {
    const spans = [
      null,
      { startLine: 0, endLine: 10 }, // size 10
      null,
      { startLine: 3, endLine: 5 } // size 2 (smallest, contains 4)
    ];
    assert.strictEqual(focusedThreadIndex(spans, 4), 3);
    // A cursor matching only a null-adjacent span still resolves correctly.
    assert.strictEqual(focusedThreadIndex([null, null], 4), -1);
  });

  it("treats span boundaries as inclusive (cursor on startLine and endLine)", () => {
    const spans = [{ startLine: 3, endLine: 7 }];
    assert.strictEqual(focusedThreadIndex(spans, 3), 0); // exactly on startLine
    assert.strictEqual(focusedThreadIndex(spans, 7), 0); // exactly on endLine
    assert.strictEqual(focusedThreadIndex(spans, 2), -1); // just before
    assert.strictEqual(focusedThreadIndex(spans, 8), -1); // just after
  });
});
