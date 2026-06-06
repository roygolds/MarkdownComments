// Real rendered-HTML regression coverage for the comments-sidebar surface model
// that produced the BLANK-SIDEBAR bug when VS Code's built-in Markdown preview
// was active. Companion to sidebarHtml.test.js — same fixtures, markers, and
// real-provider-against-a-fake-WebviewView technique, so every assertion is on
// the genuine render() output rather than internal counters.
//
// These tests guard two of the three behaviors of the fix:
//   B) PREVIEW-FIRST shows comments: opening straight into the preview (no source
//      editor ever focused) must end with the comment cards once the backing
//      document loads — NOT the blank empty state.
//   C) CLEAR on a genuine non-Markdown document, RESTORE on Markdown refocus, and
//      KEEP (do NOT clear) on an ambiguous surface (no active tab / Output panel /
//      comment input) — the guard against "reading logs clears the sidebar".
//
// (Behavior A — the built-in preview surfacing as a TabInputCustom with viewType
// "vscode.markdown.preview.editor" — cannot be forced in the headless host, where
// the preview only ever surfaces as a webview; it is covered exhaustively at the
// unit level in test/unit/activeTabKind.test.js against the extracted pure
// classifier the provider now calls.)

const assert = require("assert");
const vscode = require("vscode");

const EXT_ID = "markdowncomments.markdowncomments";

// A document that contains a MarkdownComments fence with one commented thread.
const MD_WITH_COMMENT =
  "```MarkdownComments\n" +
  "- id: mc-001\n" +
  '  quote: "version-control friendly"\n' +
  "  comments:\n" +
  "    - by: Yulia\n" +
  '      at: "2026-06-05T08:03:51Z"\n' +
  "      text: Make this promise more concrete.\n" +
  "```\n" +
  "MarkdownComments keeps Markdown readable and version-control friendly.\n";

// Stable markers in the REAL rendered HTML (see documentCards.ts / cardRender.ts).
const CARD_MARKER = 'data-thread-id="mc-001"'; // present only when cards are painted
const DOC_NOT_LOADED_TEXT = "Open the document in an editor"; // target set, doc not loaded
const NO_TARGET_TEXT = "Open a Markdown file"; // CLEARED: no active Markdown target

function makeFakeWebviewView() {
  const renderedHtmls = [];
  const messageEmitter = new vscode.EventEmitter();
  const visibilityEmitter = new vscode.EventEmitter();
  const disposeEmitter = new vscode.EventEmitter();

  const webview = {
    _options: {},
    get options() {
      return this._options;
    },
    set options(value) {
      this._options = value;
    },
    onDidReceiveMessage: messageEmitter.event,
    asWebviewUri: (u) => u,
    cspSource: "",
    _html: "",
    get html() {
      return this._html;
    },
    set html(value) {
      this._html = value;
      renderedHtmls.push(value);
    }
  };

  const view = {
    webview,
    visible: true,
    onDidChangeVisibility: visibilityEmitter.event,
    onDidDispose: disposeEmitter.event
  };

  return { view, renderedHtmls, messageEmitter, visibilityEmitter, disposeEmitter };
}

async function freshProvider() {
  const ext = vscode.extensions.getExtension(EXT_ID);
  const api = await ext.activate();
  assert.strictEqual(
    typeof api.__SidebarProviderClass,
    "function",
    "the provider class must be exposed for genuine WebviewView resolution"
  );
  const provider = new api.__SidebarProviderClass(ext.extensionUri);
  const fake = makeFakeWebviewView();
  provider.resolveWebviewView(fake.view);
  return { provider, fake, latest: () => fake.renderedHtmls[fake.renderedHtmls.length - 1] };
}

describe("MarkdownComments sidebar — surface model (real WebviewView HTML)", () => {
  // --- BEHAVIOR B: preview-first shows comments. ------------------------------
  it("B: preview-first (no source editor ever focused) ends with the comment cards once the backing document loads", async function () {
    this.timeout(40000);

    const { provider, latest } = await freshProvider();

    // A genuine markdown TextDocument; we control whether the provider "finds" it
    // so we can model the load ordering the host cannot reproduce (it pins every
    // commented .md in workspace.textDocuments). We never show its source editor —
    // this is the PREVIEW-FIRST scenario.
    const mdDoc = await vscode.workspace.openTextDocument({
      content: MD_WITH_COMMENT,
      language: "markdown"
    });
    const mdUri = mdDoc.uri.toString();

    try {
      // --- STEP 1: the target is adopted while its backing document is NOT yet
      // loaded (preview active, source never focused). The sidebar shows the
      // doc-not-loaded blank — NOT the comment cards. This is the exact moment the
      // user saw a blank Comments view in the bug. mdDoc was created AFTER the
      // provider resolved, so this is a genuine new target and forces a paint.
      provider.__setDocumentResolverForTest(() => undefined); // backing doc not loaded
      provider.__applyDecisionForTest(mdUri); // recompute adopted the backing md target
      const html1 = latest();
      assert.ok(
        !html1.includes(CARD_MARKER),
        "step 1: before the backing document loads, the sidebar must NOT show cards. Got:\n" + html1
      );
      assert.ok(
        html1.includes(DOC_NOT_LOADED_TEXT),
        "step 1: the pre-load state must be the doc-not-loaded blank. Got:\n" + html1
      );

      // --- STEP 2: the backing document finishes loading (async). -------------
      // onDidOpenTextDocument fires for the backing .md; onDocOpened RECOMPUTES,
      // and with the document now loadable while the preview is the active surface
      // the recompute repaints (modeled here by re-applying the real decision tail
      // for the SAME mdUri, which routes through setTarget()'s self-heal exactly as
      // recomputeTarget() would). The cards must now paint.
      provider.__setDocumentResolverForTest(() => mdDoc); // now loaded
      provider.__simulateDocOpenForTest(mdDoc.uri); // real onDidOpen handler runs
      provider.__applyDecisionForTest(mdUri); // recompute re-resolves the now-loaded md
      const html2 = latest();

      console.log(
        "SIDEBAR-SURFACE-B bodies=" +
          JSON.stringify({
            s1_hasCard: html1.includes(CARD_MARKER),
            s2_hasCard: html2.includes(CARD_MARKER),
            s2_isBlank: html2.includes(DOC_NOT_LOADED_TEXT) || html2.includes(NO_TARGET_TEXT)
          })
      );

      assert.ok(
        html2.includes(CARD_MARKER),
        "step 2: once the backing document loads, the PREVIEW-FIRST sidebar MUST " +
          "paint the comment cards. Latest rendered HTML:\n" + html2
      );
      assert.ok(
        !html2.includes(DOC_NOT_LOADED_TEXT) && !html2.includes(NO_TARGET_TEXT),
        "step 2: the final state must be the cards, not any blank empty state"
      );
    } finally {
      provider.__setDocumentResolverForTest(undefined);
      provider.dispose();
    }
  });

  // --- BEHAVIOR C: clear on non-md, restore on md, keep on ambiguous. ---------
  it("C: a non-Markdown document CLEARS the sidebar; refocusing the Markdown RESTORES the cards", async function () {
    this.timeout(40000);

    const { provider, latest } = await freshProvider();

    const mdDoc = await vscode.workspace.openTextDocument({
      content: MD_WITH_COMMENT,
      language: "markdown"
    });
    const mdUri = mdDoc.uri.toString();
    const txtDoc = await vscode.workspace.openTextDocument({
      content: "These are just plaintext notes, not Markdown.\n",
      language: "plaintext"
    });

    // The document is always loadable; this test drives the LIVE recompute against
    // real active-editor/tab state, so the KEEP-vs-CLEAR decision is genuine.
    provider.__setDocumentResolverForTest(() => mdDoc);

    const settle = () => new Promise((r) => setTimeout(r, 150));

    try {
      // --- PHASE 1: Markdown source is the active surface -> cards. -----------
      await vscode.window.showTextDocument(mdDoc, { preview: false });
      await settle();
      provider.__sidebarDebug({ forceRecompute: true }); // recompute on live state
      const html1 = latest();
      assert.ok(
        html1.includes(CARD_MARKER),
        "phase 1: with the Markdown source active the sidebar must show cards. Got:\n" + html1
      );

      // --- PHASE 2: a genuine non-Markdown document is active -> CLEAR. -------
      // Focusing notes.txt (plaintext) is a real other document: the recompute
      // classifies it "nonMarkdownDoc" and CLEARS the sidebar to the no-target
      // empty state. (This is the half of the fix that intentionally blanks.)
      await vscode.window.showTextDocument(txtDoc, { preview: false });
      await settle();
      provider.__sidebarDebug({ forceRecompute: true });
      const html2 = latest();
      assert.ok(
        html2.includes(NO_TARGET_TEXT),
        "phase 2: focusing a non-Markdown document must CLEAR the sidebar to the " +
          "'Open a Markdown file' empty state. Got:\n" + html2
      );
      assert.ok(
        !html2.includes(CARD_MARKER),
        "phase 2: the cleared sidebar must NOT still show the cards"
      );

      // --- PHASE 3: refocus the Markdown source -> cards RESTORED. ------------
      await vscode.window.showTextDocument(mdDoc, { preview: false });
      await settle();
      provider.__sidebarDebug({ forceRecompute: true });
      const html3 = latest();
      assert.ok(
        html3.includes(CARD_MARKER),
        "phase 3: returning to the Markdown source must RESTORE the comment cards. Got:\n" + html3
      );

      console.log(
        "SIDEBAR-SURFACE-C bodies=" +
          JSON.stringify({
            p1_hasCard: html1.includes(CARD_MARKER),
            p2_isCleared: html2.includes(NO_TARGET_TEXT),
            p3_hasCard: html3.includes(CARD_MARKER)
          })
      );
    } finally {
      provider.__setDocumentResolverForTest(undefined);
      provider.dispose();
    }
  });

  // --- BEHAVIOR C (continued): ambiguous surface KEEPS the target. ------------
  it("C: an ambiguous active surface (Output panel / comment input / no active tab) KEEPS the cards, it does NOT clear", async function () {
    this.timeout(40000);

    // Start from a clean slate so the active surface is genuinely ambiguous (no
    // active tab) — the same classification as the Output panel (scheme output:)
    // or a comment input box (scheme comment:). The per-scheme classification is
    // unit-tested exhaustively in test/unit/activeTabKind.test.js; here we prove
    // the recompute's KEEP branch does NOT blank a healthy sidebar — the guard
    // against the "reading logs clears the Comments view" regression.
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await new Promise((r) => setTimeout(r, 150));

    const { provider, latest } = await freshProvider();

    // Load the backing document but NEVER show it: no editor tab is created, so the
    // active surface stays ambiguous AND the document object stays valid (closing
    // an untitled editor would dispose it and empty getText()).
    const mdDoc = await vscode.workspace.openTextDocument({
      content: MD_WITH_COMMENT,
      language: "markdown"
    });
    const mdUri = mdDoc.uri.toString();
    provider.__setDocumentResolverForTest(() => mdDoc);

    try {
      // Establish a healthy target deterministically (no live editor -> no events):
      // the sidebar is now showing the comment cards.
      provider.__applyDecisionForTest(mdUri);
      const healthy = latest();
      assert.ok(
        healthy.includes(CARD_MARKER),
        "precondition: the sidebar shows cards before the ambiguous recompute. Got:\n" + healthy
      );

      // Force a recompute while the active surface is ambiguous (no active tab).
      const dbg = provider.__sidebarDebug({ forceRecompute: true });
      const html = latest();

      console.log(
        "SIDEBAR-SURFACE-C-AMBIGUOUS bodies=" +
          JSON.stringify({
            target: dbg.targetUri,
            hasCard: html.includes(CARD_MARKER),
            isCleared: html.includes(NO_TARGET_TEXT)
          })
      );

      assert.strictEqual(
        dbg.targetUri,
        mdUri,
        "an ambiguous surface (no active tab) must KEEP the Markdown target, not clear it"
      );
      assert.ok(
        html.includes(CARD_MARKER) && !html.includes(NO_TARGET_TEXT),
        "an ambiguous surface must NOT blank the sidebar — the cards remain. Got:\n" + html
      );
    } finally {
      provider.__setDocumentResolverForTest(undefined);
      provider.dispose();
    }
  });
});
