// Unit tests for classifyActiveTab — the pure tab-classification helper extracted
// from CommentsSidebarProvider.activeTabKind(). Run with: npm run test:unit
//
// REGRESSION GUARDED (behavior A): the activity-bar Comments sidebar went BLANK
// whenever the user viewed VS Code's built-in Markdown preview, because that
// preview can surface in the tabs API as a TabInputCustom with viewType
// "vscode.markdown.preview.editor" (NOT a TabInputWebview "markdown.preview").
// Detection that only matched TabInputWebview classified the active preview as a
// non-Markdown surface, so the recompute model CLEARED the sidebar. The most
// important assertion below is that a "custom" tab with that viewType classifies
// as "markdownPreview" (a preview-like surface the sidebar keeps following), and
// that an UNRELATED custom editor still classifies as "nonMarkdownDoc".
//
// activeTabKind() reads vscode.window.tabGroups (impossible to force a custom
// Markdown-preview tab in the headless integration host — there it only ever
// surfaces as a webview), so the classification is extracted into this pure
// function which the provider calls, letting us cover every case deterministically.

const assert = require("assert");
const path = require("path");
const { classifyActiveTab, PANEL_VIEW_TYPE } = require(
  path.join(__dirname, "..", "..", "src", "preview", "activeTabKind.js")
);

describe("classifyActiveTab", () => {
  // --- THE CORE REGRESSION (behavior A) ----------------------------------------
  it("classifies the built-in preview surfaced as a CUSTOM editor as markdownPreview (the blank-sidebar regression)", () => {
    // This is the exact input type/viewType that produced the blank sidebar.
    assert.strictEqual(
      classifyActiveTab({ kind: "custom", viewType: "vscode.markdown.preview.editor" }),
      "markdownPreview"
    );
  });

  it("is case-insensitive for the custom-editor markdown.preview viewType", () => {
    assert.strictEqual(
      classifyActiveTab({ kind: "custom", viewType: "VSCode.Markdown.Preview.Editor" }),
      "markdownPreview"
    );
  });

  it("classifies a GENERIC custom editor (not a markdown preview) as nonMarkdownDoc", () => {
    // A real custom editor (e.g. an image/hex editor) genuinely is another
    // document, so focusing it should be allowed to clear the sidebar.
    assert.strictEqual(
      classifyActiveTab({ kind: "custom", viewType: "imagePreview.previewEditor" }),
      "nonMarkdownDoc"
    );
  });

  // --- Webview preview surfaces ------------------------------------------------
  it("classifies the built-in preview surfaced as a webview as markdownPreview", () => {
    assert.strictEqual(
      classifyActiveTab({ kind: "webview", viewType: "mainThreadWebview-markdown.preview" }),
      "markdownPreview"
    );
  });

  it("classifies our own preview panel's webview viewType as markdownPreview", () => {
    assert.strictEqual(
      classifyActiveTab({ kind: "webview", viewType: "markdownCommentsPreview" }),
      "markdownPreview"
    );
    // Guard the constant the helper matches against, lower-cased.
    assert.strictEqual(PANEL_VIEW_TYPE, "markdowncommentspreview");
  });

  it("classifies an unrecognized webview as previewLikeWebview (so the sidebar still follows it)", () => {
    assert.strictEqual(
      classifyActiveTab({ kind: "webview", viewType: "mainThreadWebview-some.other.view" }),
      "previewLikeWebview"
    );
  });

  // --- Text tabs ---------------------------------------------------------------
  it("classifies a loaded markdown text tab as markdownSource", () => {
    assert.strictEqual(
      classifyActiveTab({ kind: "text", uriScheme: "file", languageId: "markdown", path: "/docs/a.md" }),
      "markdownSource"
    );
  });

  it("classifies a loaded NON-markdown text tab (e.g. notes.txt, plaintext) as nonMarkdownDoc", () => {
    assert.strictEqual(
      classifyActiveTab({ kind: "text", uriScheme: "file", languageId: "plaintext", path: "/docs/notes.txt" }),
      "nonMarkdownDoc"
    );
  });

  it("classifies a not-yet-loaded .md text tab as markdownSource via the path extension", () => {
    // languageId undefined => document not loaded yet; fall back to the extension.
    assert.strictEqual(
      classifyActiveTab({ kind: "text", uriScheme: "file", path: "/docs/a.md" }),
      "markdownSource"
    );
  });

  it("classifies a not-yet-loaded non-.md text tab as nonMarkdownDoc via the path extension", () => {
    assert.strictEqual(
      classifyActiveTab({ kind: "text", uriScheme: "file", path: "/docs/notes.txt" }),
      "nonMarkdownDoc"
    );
  });

  it("classifies an untitled markdown text tab as markdownSource", () => {
    assert.strictEqual(
      classifyActiveTab({ kind: "text", uriScheme: "untitled", languageId: "markdown", path: "Untitled-1" }),
      "markdownSource"
    );
  });

  // --- Ambiguous (non-content) schemes: MUST NOT clear the sidebar -------------
  it("classifies a comment: scheme text tab (comment input box) as ambiguous", () => {
    assert.strictEqual(
      classifyActiveTab({ kind: "text", uriScheme: "comment", languageId: "markdown", path: "/x" }),
      "ambiguous"
    );
  });

  it("classifies an output: scheme text tab (Output panel / reading logs) as ambiguous, so it does NOT clear the sidebar", () => {
    assert.strictEqual(
      classifyActiveTab({ kind: "text", uriScheme: "output", languageId: "log", path: "/extension-output" }),
      "ambiguous"
    );
  });

  it("classifies other non-content schemes (git:, vscode-userdata:) as ambiguous", () => {
    assert.strictEqual(
      classifyActiveTab({ kind: "text", uriScheme: "git", path: "/repo/a.md" }),
      "ambiguous"
    );
    assert.strictEqual(
      classifyActiveTab({ kind: "text", uriScheme: "vscode-userdata", path: "/settings.json" }),
      "ambiguous"
    );
  });

  // --- Other input kinds -------------------------------------------------------
  it("classifies a notebook tab as nonMarkdownDoc", () => {
    assert.strictEqual(classifyActiveTab({ kind: "notebook" }), "nonMarkdownDoc");
  });

  it("classifies no active tab (kind 'none') as ambiguous", () => {
    assert.strictEqual(classifyActiveTab({ kind: "none" }), "ambiguous");
  });

  it("classifies an unknown/other input kind as ambiguous", () => {
    assert.strictEqual(classifyActiveTab({ kind: "other" }), "ambiguous");
  });

  // --- Defensive: missing/empty fields default safely -------------------------
  it("treats a webview with no viewType as previewLikeWebview (never throws)", () => {
    assert.strictEqual(classifyActiveTab({ kind: "webview" }), "previewLikeWebview");
  });

  it("treats a custom editor with no viewType as nonMarkdownDoc (never throws)", () => {
    assert.strictEqual(classifyActiveTab({ kind: "custom" }), "nonMarkdownDoc");
  });

  it("treats a null/undefined descriptor as ambiguous (never throws)", () => {
    assert.strictEqual(classifyActiveTab(undefined), "ambiguous");
    assert.strictEqual(classifyActiveTab(null), "ambiguous");
  });
});
