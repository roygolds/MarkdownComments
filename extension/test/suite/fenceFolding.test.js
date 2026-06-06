// Integration test for source-editor folding of ```MarkdownComments fences.
// Runs inside the VS Code host (npm run test:integration).
//
// Two regression surfaces:
//  1. FOLDABILITY — the built-in command driving our registered
//     FoldingRangeProvider returns a FoldingRange whose `.start` equals the
//     fence's opening (```MarkdownComments) line.
//  2. AUTO-COLLAPSE SCOPE — showing the document triggers the extension's own
//     auto-fold, which must collapse ONLY the fence, not the enclosing built-in
//     Markdown heading region. We assert the inner YAML lines leave view AND
//     that the non-fence heading/intro/body lines stay visible. The old test
//     only checked an inner line was hidden, which a "whole heading collapsed"
//     bug ALSO satisfies — so it missed the regression where everything got
//     collapsed down to the heading line. We exercise the real feature end to
//     end (we never call `editor.fold` ourselves).

const assert = require("assert");
const vscode = require("vscode");

const EXT_ID = "markdowncomments.markdowncomments";

// A heading ABOVE the fence and BODY text AFTER it, so the built-in Markdown
// heading folding region [0, EOF] strictly contains the fence region [2,5].
// 0-based lines:
//   0: # Title             (heading — MUST stay visible)
//   1: intro               (non-fence — MUST stay visible)
//   2: ```MarkdownComments (fence open)
//   3: a: 1                (inner YAML — MUST be hidden)
//   4: b: 2                (inner YAML — MUST be hidden)
//   5: ```                 (fence close)
//   6: Body one            (non-fence — MUST stay visible)
//   7: Body two            (non-fence — MUST stay visible)
const content =
  "# Title\n" +
  "intro\n" +
  "```MarkdownComments\n" +
  "a: 1\n" +
  "b: 2\n" +
  "```\n" +
  "Body one\n" +
  "Body two\n";
const fenceOpenLine = 2;
const innerLines = [3, 4];
const visibleLines = [1, 6]; // intro and body one must remain visible

function isHidden(editor, line) {
  return !editor.visibleRanges.some((r) => line >= r.start.line && line <= r.end.line);
}

function dumpRanges(editor) {
  return JSON.stringify(
    editor.visibleRanges.map((r) => ({ start: r.start.line, end: r.end.line }))
  );
}

describe("MarkdownComments source-editor fence folding", () => {
  it("exposes each ```MarkdownComments fence as a foldable region", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, "extension should be installed");
    await ext.activate();

    const doc = await vscode.workspace.openTextDocument({
      language: "markdown",
      content
    });
    await vscode.window.showTextDocument(doc);

    let ranges = [];
    for (let i = 0; i < 30; i++) {
      ranges =
        (await vscode.commands.executeCommand(
          "vscode.executeFoldingRangeProvider",
          doc.uri
        )) || [];
      if (ranges.some((r) => r.start === fenceOpenLine)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    assert.ok(
      ranges.some((r) => r.start === fenceOpenLine),
      `expected a folding range starting at the fence opening line ${fenceOpenLine}, got ${JSON.stringify(
        ranges
      )}`
    );
  });

  it("auto-collapses ONLY the fence on open (heading + body stay visible)", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, "extension should be installed");
    await ext.activate();

    const doc = await vscode.workspace.openTextDocument({
      language: "markdown",
      content
    });
    // Showing the document triggers the extension's own auto-fold. We do NOT
    // call editor.fold ourselves — this exercises the real feature.
    const editor = await vscode.window.showTextDocument(doc);

    // Poll until BOTH the inner YAML lines are hidden AND the non-fence lines are
    // still visible. A "whole heading collapsed" bug hides the inner lines too,
    // but it ALSO hides the intro/body lines — so condition (b) catches it.
    let ok = false;
    for (let i = 0; i < 60; i++) {
      const innerHidden = innerLines.every((line) => isHidden(editor, line));
      const neighboursVisible = visibleLines.every((line) => !isHidden(editor, line));
      if (innerHidden && neighboursVisible) {
        ok = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    assert.ok(
      ok,
      `expected ONLY the fence to collapse: inner YAML lines ${JSON.stringify(
        innerLines
      )} hidden and non-fence lines ${JSON.stringify(
        visibleLines
      )} still visible; visibleRanges=${dumpRanges(editor)}`
    );

    // Explicit per-condition assertions for a clearer failure signal.
    for (const line of innerLines) {
      assert.ok(
        isHidden(editor, line),
        `inner YAML line ${line} should be hidden; visibleRanges=${dumpRanges(editor)}`
      );
    }
    for (const line of visibleLines) {
      assert.ok(
        !isHidden(editor, line),
        `non-fence line ${line} should stay visible (heading region must NOT collapse); ` +
          `visibleRanges=${dumpRanges(editor)}`
      );
    }
  });
});
