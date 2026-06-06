// Unit tests for the custom-editor-preview precedence override used by the
// comments sidebar's recomputeTarget(). Run with: npm run test:unit
//
// Background: VS Code's built-in Markdown preview can surface as a CUSTOM editor
// (TabInputCustom, viewType "vscode.markdown.preview.editor") whose tab input
// exposes the previewed document's uri DIRECTLY. recomputeTarget() reads live
// vscode.window.tabGroups (impossible to force a custom-editor preview in the
// headless integration host), so the precedence decision is extracted here into
// a pure, dependency-free helper and covered exhaustively.

const assert = require("assert");
const path = require("path");
const { chooseCustomPreviewOverride } = require(
  path.join(__dirname, "..", "..", "src", "preview", "customPreviewTarget.js")
);

const A = "file:///a.md";
const B = "file:///b.md";
const PANEL = "file:///panel.md";

const BASE = {
  activeMarkdownEditorUri: null,
  panelSourceUri: null,
  customPreviewUri: null
};

function decide(overrides) {
  return chooseCustomPreviewOverride(Object.assign({}, BASE, overrides));
}

describe("chooseCustomPreviewOverride", () => {
  it("targets the custom-editor preview's backing uri directly (Issue 1)", () => {
    // Switching to a custom-editor preview of file B while A is still the loaded
    // target: the backing uri is authoritative and must win over the anti-churn
    // heuristic in chooseSidebarTarget (which would keep A).
    assert.strictEqual(decide({ customPreviewUri: B }), B);
  });

  it("defers to chooseSidebarTarget (null) when a markdown source editor is active", () => {
    // A focused source editor ranks higher than any preview.
    assert.strictEqual(
      decide({ activeMarkdownEditorUri: A, customPreviewUri: B }),
      null
    );
  });

  it("defers to chooseSidebarTarget (null) when our interactive panel owns a source", () => {
    // Our preview panel ranks higher than the built-in preview.
    assert.strictEqual(
      decide({ panelSourceUri: PANEL, customPreviewUri: B }),
      null
    );
  });

  it("prefers the source editor over the panel and custom preview (full precedence)", () => {
    assert.strictEqual(
      decide({
        activeMarkdownEditorUri: A,
        panelSourceUri: PANEL,
        customPreviewUri: B
      }),
      null
    );
  });

  it("returns null when there is no custom-editor preview uri (defer to chooseSidebarTarget)", () => {
    assert.strictEqual(decide({}), null);
    assert.strictEqual(decide({ customPreviewUri: null }), null);
  });

  it("treats an empty-string custom preview uri as absent", () => {
    assert.strictEqual(decide({ customPreviewUri: "" }), null);
  });
});
