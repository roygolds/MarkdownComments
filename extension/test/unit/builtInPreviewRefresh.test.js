// Unit tests for the pure helpers behind the sidebar-visibility -> built-in
// preview re-render path (Issue 2). Run with: npm run test:unit
//
// REGRESSION GUARDED (Issue 2): HIDING the Comments sidebar did not make inline
// comment cards reappear in VS Code's built-in Markdown preview. Cards are
// suppressed server-side while the sidebar is visible (markdownItPlugin.ts:
// `if (!options.interactive && isSidebarVisible()) return anchor;`), so toggling
// visibility requires forcing a preview RE-RENDER. refreshBuiltInPreview() does
// that; when the preview is surfacing as a CUSTOM editor (TabInputCustom,
// viewType "vscode.markdown.preview.editor") it fires an extra best-effort kick.
//
// Two pieces of that logic are extracted into the dependency-free
// src/preview/builtInPreviewRefresh.js (which production now calls) so they are
// deterministically testable — the live custom-editor preview re-render CANNOT be
// exercised headlessly (in the integration host the preview only ever surfaces as
// a webview), so faking a "it re-rendered" assertion would be dishonest. Instead
// we cover (1) the tab-input predicate isCustomEditorPreviewOpen() applies, and
// (2) the command-selection decision refreshBuiltInPreview() makes. The actual
// live re-render of a custom-editor preview on sidebar hide remains a SMOKE-TEST
// item (documented in the report); the server-side suppression + anchor emission
// half of the coupling is covered by the existing integration test in
// test/suite/extension.test.js ("built-in preview suppresses inline comment cards
// while the sidebar is visible").

const assert = require("assert");
const path = require("path");

const { isCustomMarkdownPreviewTabInput, chooseRefreshCommands } = require(
  path.join(__dirname, "..", "..", "src", "preview", "builtInPreviewRefresh.js")
);

describe("isCustomMarkdownPreviewTabInput (Issue 2: detecting the custom-editor preview)", () => {
  // --- THE CASE THE EXTRA REFRESH KICK EXISTS FOR ------------------------------
  it("returns true for the built-in preview surfaced as a CUSTOM editor (the bug's variant)", () => {
    assert.strictEqual(
      isCustomMarkdownPreviewTabInput({ kind: "custom", viewType: "vscode.markdown.preview.editor" }),
      true
    );
  });

  it("is case-insensitive on the custom-editor markdown.preview viewType", () => {
    assert.strictEqual(
      isCustomMarkdownPreviewTabInput({ kind: "custom", viewType: "VSCode.Markdown.Preview.Editor" }),
      true
    );
  });

  // --- CONTRACT: custom-editor ONLY (webview preview detected elsewhere) -------
  it("returns FALSE for a WEBVIEW markdown.preview (per its custom-only contract)", () => {
    // The webview preview (DynamicMarkdownPreview) is recognized by other code;
    // this predicate gates ONLY the extra custom-editor-specific refresh kick.
    assert.strictEqual(
      isCustomMarkdownPreviewTabInput({ kind: "webview", viewType: "mainThreadWebview-markdown.preview" }),
      false
    );
  });

  // --- Non-matches: never true -------------------------------------------------
  it("returns false for a GENERIC custom editor (e.g. image/hex editor)", () => {
    assert.strictEqual(
      isCustomMarkdownPreviewTabInput({ kind: "custom", viewType: "imagePreview.previewEditor" }),
      false
    );
  });

  it("returns false for a custom editor with no/empty viewType (never throws)", () => {
    assert.strictEqual(isCustomMarkdownPreviewTabInput({ kind: "custom" }), false);
    assert.strictEqual(isCustomMarkdownPreviewTabInput({ kind: "custom", viewType: "" }), false);
    assert.strictEqual(isCustomMarkdownPreviewTabInput({ kind: "custom", viewType: null }), false);
  });

  it("returns false for text, notebook, none, other, and missing descriptors (never throws)", () => {
    assert.strictEqual(isCustomMarkdownPreviewTabInput({ kind: "text" }), false);
    assert.strictEqual(isCustomMarkdownPreviewTabInput({ kind: "notebook" }), false);
    assert.strictEqual(isCustomMarkdownPreviewTabInput({ kind: "none" }), false);
    assert.strictEqual(isCustomMarkdownPreviewTabInput({ kind: "other" }), false);
    assert.strictEqual(isCustomMarkdownPreviewTabInput(undefined), false);
    assert.strictEqual(isCustomMarkdownPreviewTabInput(null), false);
    assert.strictEqual(isCustomMarkdownPreviewTabInput({}), false);
  });
});

describe("chooseRefreshCommands (Issue 2: which refresh commands run on sidebar hide)", () => {
  it("runs markdown.preview.refresh alone for a WEBVIEW preview (no custom-editor kick)", () => {
    // The common case: a webview preview is open. The primary force-refresh runs;
    // the custom-editor-only reloadPlugins kick does NOT (customPreviewOpen false).
    assert.deepStrictEqual(
      chooseRefreshCommands({ customPreviewOpen: false, hasRefresh: true, hasReloadPlugins: true }),
      ["markdown.preview.refresh"]
    );
  });

  it("ALSO runs markdown.api.reloadPlugins when a custom-editor preview is open (the Issue 2 fix)", () => {
    // The bug's variant: a custom-editor preview is open, so BOTH commands run, in
    // order, to force the StaticMarkdownPreview to re-render and un-suppress cards.
    assert.deepStrictEqual(
      chooseRefreshCommands({ customPreviewOpen: true, hasRefresh: true, hasReloadPlugins: true }),
      ["markdown.preview.refresh", "markdown.api.reloadPlugins"]
    );
  });

  it("does NOT run reloadPlugins for a custom-editor preview when the command is unavailable", () => {
    // Best-effort: a VS Code build without markdown.api.reloadPlugins still gets
    // the primary refresh and nothing more.
    assert.deepStrictEqual(
      chooseRefreshCommands({ customPreviewOpen: true, hasRefresh: true, hasReloadPlugins: false }),
      ["markdown.preview.refresh"]
    );
  });

  it("runs reloadPlugins WITHOUT the primary refresh when only reloadPlugins exists and a custom preview is open", () => {
    // Guards the independence of the two branches: the custom-editor kick is not
    // gated on the primary refresh being available.
    assert.deepStrictEqual(
      chooseRefreshCommands({ customPreviewOpen: true, hasRefresh: false, hasReloadPlugins: true }),
      ["markdown.api.reloadPlugins"]
    );
  });

  it("returns an empty list when no markdown refresh command is available (logged as a no-op)", () => {
    assert.deepStrictEqual(
      chooseRefreshCommands({ customPreviewOpen: true, hasRefresh: false, hasReloadPlugins: false }),
      []
    );
    assert.deepStrictEqual(
      chooseRefreshCommands({ customPreviewOpen: false, hasRefresh: false, hasReloadPlugins: false }),
      []
    );
  });

  it("never includes reloadPlugins when no custom-editor preview is open, even if available", () => {
    assert.deepStrictEqual(
      chooseRefreshCommands({ customPreviewOpen: false, hasRefresh: true, hasReloadPlugins: true }),
      ["markdown.preview.refresh"]
    );
  });
});
