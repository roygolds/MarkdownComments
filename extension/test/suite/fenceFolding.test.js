// Integration test for source-editor folding of ```MarkdownComments fences.
// Runs inside the VS Code host (npm run test:integration).
//
// Two regression surfaces:
//  1. FOLDABILITY — the built-in command driving our registered
//     FoldingRangeProvider returns a FoldingRange whose `.start` equals the
//     fence's opening (```MarkdownComments) line.
//  2. AUTO-COLLAPSE — showing the document triggers the extension's own
//     auto-fold, which actually collapses the fence so the inner YAML line
//     leaves `editor.visibleRanges`. This exercises the real feature end to end
//     (we never call `editor.fold` ourselves) and would have caught the cold-
//     start no-op bug where folding ran before the folding model was built.

const assert = require("assert");
const vscode = require("vscode");

const EXT_ID = "markdowncomments.markdowncomments";

// A two-line prologue then a multi-line fence opening on line 2 (0-based), with
// an inner YAML line on line 5.
const content =
  "# Title\n" +
  "\n" +
  "```MarkdownComments\n" +
  "- id: mc-001\n" +
  "  comments:\n" +
  "    - by: A\n" +
  '      at: "2026-06-05T08:03:51Z"\n' +
  "      text: hello folding\n" +
  "```\n" +
  "Body paragraph.\n";
const fenceOpenLine = 2;
const innerLine = 5;

function innerVisible(editor, line) {
  return editor.visibleRanges.some((r) => line >= r.start.line && line <= r.end.line);
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

  it("auto-collapses the fence on open so the inner YAML leaves view", async () => {
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

    let collapsed = false;
    for (let i = 0; i < 50; i++) {
      if (!innerVisible(editor, innerLine)) {
        collapsed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    assert.ok(
      collapsed,
      `expected inner fence line ${innerLine} to be collapsed out of view, but it is still visible; ` +
        `visibleRanges=${JSON.stringify(
          editor.visibleRanges.map((r) => ({ start: r.start.line, end: r.end.line }))
        )}`
    );
  });
});
