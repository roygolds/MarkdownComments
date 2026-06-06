// Unit tests for the RECOMPUTE WIRING that ties the active-tab classifier to the
// custom-editor-preview precedence override — i.e. the exact derivation
// recomputeTarget() performs in src/preview/commentsSidebar.ts. Run with:
//   npm run test:unit
//
// REGRESSION GUARDED (Issue 1): switching from a .md SOURCE tab to the built-in
// Markdown PREVIEW tab did not update the sidebar when the preview surfaced as a
// CUSTOM editor (TabInputCustom, viewType "vscode.markdown.preview.editor"). The
// fix routes the custom-editor preview's backing input.uri DIRECTLY as the target
// so it bypasses chooseSidebarTarget()'s anti-churn "keep current target"
// shortcut (which would otherwise keep a previously-loaded file's comments).
//
// The two pure helpers (classifyActiveTab, chooseCustomPreviewOverride) are each
// unit-tested in isolation (activeTabKind.test.js / customPreviewTarget.test.js).
// recomputeTarget() reads LIVE vscode.window.tabGroups — and the headless
// integration host can NEVER surface the preview as a custom editor (there it is
// always a webview) — so this file re-creates recomputeTarget()'s exact glue
// between the two helpers and asserts the end-to-end target decision. It is the
// closest deterministic proof that "switch to file B's custom-editor preview ->
// target B" that is achievable without a live host. The live custom-editor
// preview switch remains a SMOKE-TEST item (documented in the report).

const assert = require("assert");
const path = require("path");

const { classifyActiveTab } = require(
  path.join(__dirname, "..", "..", "src", "preview", "activeTabKind.js")
);
const { chooseCustomPreviewOverride } = require(
  path.join(__dirname, "..", "..", "src", "preview", "customPreviewTarget.js")
);

// Mirror of the customPreviewUri derivation in recomputeTarget() (commentsSidebar.ts):
//   const customPreviewUri =
//     kind === "markdownPreview" && activeTabDesc.kind === "custom"
//       ? activeTabDesc.uri ?? null
//       : null;
// Only a CUSTOM-editor markdown preview exposes a backing uri to target directly;
// a webview preview classifies as "markdownPreview" too but carries no uri here.
function deriveCustomPreviewUri(activeTabDesc) {
  const kind = classifyActiveTab(activeTabDesc);
  return kind === "markdownPreview" && activeTabDesc && activeTabDesc.kind === "custom"
    ? activeTabDesc.uri ?? null
    : null;
}

// Mirror of recomputeTarget()'s precedence head:
//   override ?? chooseSidebarTarget(...). We assert the OVERRIDE leg here (the
//   chooseSidebarTarget leg is covered in sidebarTarget.test.js); a non-null
//   override is exactly the value recomputeTarget() would adopt as the target.
function recomputeOverride({ activeMarkdownEditorUri = null, panelSourceUri = null, activeTabDesc }) {
  const customPreviewUri = deriveCustomPreviewUri(activeTabDesc);
  return chooseCustomPreviewOverride({ activeMarkdownEditorUri, panelSourceUri, customPreviewUri });
}

describe("recomputeTarget wiring: classifyActiveTab -> chooseCustomPreviewOverride (Issue 1)", () => {
  it("switching to a DIFFERENT file's custom-editor preview targets THAT file, not a still-loaded previous target", () => {
    // The exact input that produced the stale sidebar: focus is the built-in
    // preview of b.md surfacing as a TabInputCustom. classifyActiveTab => the
    // preview surface, and its backing input.uri must become the target directly.
    const desc = {
      kind: "custom",
      viewType: "vscode.markdown.preview.editor",
      uri: "file:///b.md"
    };
    assert.strictEqual(classifyActiveTab(desc), "markdownPreview");
    assert.strictEqual(
      recomputeOverride({ activeMarkdownEditorUri: null, panelSourceUri: null, activeTabDesc: desc }),
      "file:///b.md"
    );
  });

  it("a WEBVIEW markdown preview yields NO override (no backing uri) so it defers to chooseSidebarTarget", () => {
    // A webview preview is also classified "markdownPreview" but exposes no uri in
    // the descriptor, so the override must be null (the webview path resolves the
    // backing doc via chooseSidebarTarget instead). This guards against wrongly
    // treating the webview variant as having a directly-targetable uri.
    const desc = { kind: "webview", viewType: "mainThreadWebview-markdown.preview" };
    assert.strictEqual(classifyActiveTab(desc), "markdownPreview");
    assert.strictEqual(
      recomputeOverride({ activeMarkdownEditorUri: null, panelSourceUri: null, activeTabDesc: desc }),
      null
    );
  });

  it("a GENERIC custom editor (e.g. image preview) yields NO override (classifies as another document)", () => {
    // A non-markdown custom editor classifies as "nonMarkdownDoc", so no preview
    // uri is derived and the override is null (recompute will CLEAR for it).
    const desc = { kind: "custom", viewType: "imagePreview.previewEditor", uri: "file:///pic.png" };
    assert.strictEqual(classifyActiveTab(desc), "nonMarkdownDoc");
    assert.strictEqual(
      recomputeOverride({ activeMarkdownEditorUri: null, panelSourceUri: null, activeTabDesc: desc }),
      null
    );
  });

  it("an active markdown SOURCE editor wins over the custom-editor preview (override defers to null)", () => {
    // Even with a custom-editor preview of b.md focused-in-tab, a focused markdown
    // source editor ranks higher, so the override must defer (null) and let the
    // source win via chooseSidebarTarget's branch a.
    const desc = {
      kind: "custom",
      viewType: "vscode.markdown.preview.editor",
      uri: "file:///b.md"
    };
    assert.strictEqual(
      recomputeOverride({
        activeMarkdownEditorUri: "file:///a.md",
        panelSourceUri: null,
        activeTabDesc: desc
      }),
      null
    );
  });

  it("our interactive preview panel's source wins over the custom-editor preview (override defers to null)", () => {
    // The panel ranks higher than the built-in preview, so the override defers.
    const desc = {
      kind: "custom",
      viewType: "vscode.markdown.preview.editor",
      uri: "file:///b.md"
    };
    assert.strictEqual(
      recomputeOverride({
        activeMarkdownEditorUri: null,
        panelSourceUri: "file:///panel.md",
        activeTabDesc: desc
      }),
      null
    );
  });
});
