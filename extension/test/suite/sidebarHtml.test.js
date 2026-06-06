// Genuine sidebar-HTML reproduction of the blank-sidebar bug.
//
// WHY THIS EXISTS: the earlier blank-sidebar test asserts on the provider's
// internal render counters (renderCount / lastRenderHasComments). Those counters
// do NOT prove the activity-bar WebviewView actually shows or blanks comments,
// because the headless host never resolves that view, so render() never paints a
// real webview body. This test instead resolves a REAL CommentsSidebarProvider
// against a FAKE WebviewView that captures every HTML string the provider paints,
// and asserts on that genuine rendered HTML across the user's flow.
//
// ROOT CAUSE under test (observable purely in the captured HTML):
//   setTarget()'s change-guard. When the user returns to the built-in preview the
//   recompute decides the SAME .md uri, so setTarget() skips render() and the
//   webview keeps the stale blank body painted when the document had unloaded.
//
// HOST-FIDELITY NOTE: the integration host pins every commented .md in
// workspace.textDocuments (CommentController never disposes its threads), so
// findDocument() can never naturally observe the "document unloaded" condition
// that produces the blank. We therefore model document presence with the smallest
// possible test-only seam (__setDocumentResolverForTest) and drive the exact
// production code paths (__applyDecisionForTest mirrors recomputeTarget()'s tail
// through the real setTarget() change-guard; __simulateDocCloseForTest invokes the
// real onDidCloseTextDocument handler). Every assertion is on the actual render()
// output HTML in the fake webview -- not on counters.

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

// Stable markers in the REAL rendered HTML (see cardRender.ts / documentCards.ts).
const CARD_MARKER = 'data-thread-id="mc-001"'; // present only when cards are painted
const BLANK_TEXT = "Open the document in an editor"; // target set but document not loaded

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

describe("MarkdownComments sidebar — real rendered-HTML blank reproduction", () => {
  it("returning to the built-in preview after a non-Markdown tab re-paints the comment cards (REAL WebviewView HTML)", async function () {
    this.timeout(40000);

    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    assert.strictEqual(
      typeof api.__SidebarProviderClass,
      "function",
      "the provider class must be exposed for genuine WebviewView resolution"
    );

    // Build a REAL provider and resolve it against the fake WebviewView so that
    // render() actually paints into a webview we can inspect.
    const provider = new api.__SidebarProviderClass(ext.extensionUri);
    const fake = makeFakeWebviewView();
    provider.resolveWebviewView(fake.view);

    // A genuine markdown TextDocument; we control whether the provider "finds" it
    // to model the host-masked load/unload transitions.
    const mdDoc = await vscode.workspace.openTextDocument({
      content: MD_WITH_COMMENT,
      language: "markdown"
    });
    const mdUri = mdDoc.uri.toString();

    const latest = () => fake.renderedHtmls[fake.renderedHtmls.length - 1];

    try {
      // --- STEP (a): .md source active, document LOADED -> cards. -------------
      provider.__setDocumentResolverForTest(() => mdDoc);
      provider.__applyDecisionForTest(mdUri); // setTarget(undefined -> md) -> render()
      const htmlA = latest();
      assert.ok(
        htmlA.includes(CARD_MARKER),
        "step (a): the rendered sidebar HTML must contain the comment card. Got:\n" + htmlA
      );
      assert.ok(
        !htmlA.includes(BLANK_TEXT),
        "step (a): the rendered sidebar HTML must NOT be the empty state"
      );

      // --- STEP (b): document unloads (switch away) -> BLANK empty state. -----
      provider.__setDocumentResolverForTest(() => undefined); // no longer loaded
      provider.__simulateDocCloseForTest(mdDoc.uri); // real close handler -> render()
      const htmlB = latest();
      assert.ok(
        htmlB.includes(BLANK_TEXT),
        "step (b): the rendered sidebar HTML must be the blank empty state. Got:\n" + htmlB
      );
      assert.ok(
        !htmlB.includes(CARD_MARKER),
        "step (b): the blank state must NOT contain the comment card"
      );

      // --- STEP (c): return to the built-in preview, .md reloaded. ------------
      // The recompute decides the SAME .md uri, exactly as on preview
      // re-activation in the real product.
      provider.__setDocumentResolverForTest(() => mdDoc); // reloaded
      provider.__applyDecisionForTest(mdUri); // SAME uri -> change-guard skips render()
      const htmlC = latest();

      console.log(
        "SIDEBAR-HTML-REPRO bodies=" +
          JSON.stringify({
            a_hasCard: htmlA.includes(CARD_MARKER),
            b_isBlank: htmlB.includes(BLANK_TEXT),
            c_hasCard: htmlC.includes(CARD_MARKER),
            c_isBlank: htmlC.includes(BLANK_TEXT),
            paintCount: fake.renderedHtmls.length
          })
      );

      // --- THE BUG (step d): on current code htmlC is STILL the blank body, ---
      // because setTarget()'s change-guard suppressed the recovering render.
      // This assertion FAILS on current code, proving the blank sidebar at the
      // real rendered-HTML level.
      assert.ok(
        htmlC.includes(CARD_MARKER),
        "step (c): returning to the built-in preview MUST re-paint the comment cards, " +
          "but the rendered sidebar HTML is still the blank empty state because " +
          "setTarget()'s change-guard skipped render(). Latest rendered HTML:\n" +
          htmlC
      );
    } finally {
      provider.__setDocumentResolverForTest(undefined);
      provider.dispose();
    }
  });

  it("async reload AFTER the tab-activation recompute already ran (still unloaded) recovers the cards via onDidOpen (REAL WebviewView HTML)", async function () {
    this.timeout(40000);

    // This test exercises a DIFFERENT failure ordering than the test above.
    // Above, the recompute fires while the document is ALREADY reloaded, so
    // setTarget()'s self-heal (renderStateChanged) can repaint. HERE we model the
    // worst-case ASYNC ordering the developer fixed with onDidOpenTextDocument:
    // the tab-activation recompute runs FIRST while the target .md is STILL
    // unloaded — so findDocument() is undefined at that moment and the self-heal
    // has nothing loadable to repaint — and the document only reloads AFTERWARDS,
    // asynchronously. Only the onDidOpen handler (onDocOpened) can recover the
    // cards in that ordering. Every assertion is on the genuine render() HTML.

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

    const mdDoc = await vscode.workspace.openTextDocument({
      content: MD_WITH_COMMENT,
      language: "markdown"
    });
    const mdUri = mdDoc.uri.toString();

    const latest = () => fake.renderedHtmls[fake.renderedHtmls.length - 1];

    try {
      // --- STEP 1: target set, document LOADED -> cards painted. --------------
      provider.__setDocumentResolverForTest(() => mdDoc);
      provider.__applyDecisionForTest(mdUri); // setTarget(undefined -> md) -> render()
      const html1 = latest();
      assert.ok(
        html1.includes(CARD_MARKER),
        "step 1: the rendered sidebar HTML must contain the comment card. Got:\n" + html1
      );
      assert.ok(
        !html1.includes(BLANK_TEXT),
        "step 1: the rendered sidebar HTML must NOT be the empty state"
      );

      // --- STEP 2: document unloads -> BLANK empty state. ---------------------
      provider.__setDocumentResolverForTest(() => undefined); // no longer loaded
      provider.__simulateDocCloseForTest(mdDoc.uri); // real close handler -> render()
      const html2 = latest();
      assert.ok(
        html2.includes(BLANK_TEXT),
        "step 2: the rendered sidebar HTML must be the blank empty state. Got:\n" + html2
      );
      assert.ok(
        !html2.includes(CARD_MARKER),
        "step 2: the blank state must NOT contain the comment card"
      );

      // --- STEP 3: WORST-CASE ASYNC ORDERING, part A. ------------------------
      // The tab-activation recompute fires FIRST, while the document is STILL
      // unloaded. The recompute decides the SAME target uri, but findDocument()
      // is undefined right now, so setTarget()'s self-heal cannot repaint cards.
      // The HTML MUST stay blank — proving the recompute alone is insufficient,
      // which is exactly why the onDidOpen handler was needed.
      provider.__applyDecisionForTest(mdUri); // SAME uri, document still undefined
      const html3 = latest();
      assert.ok(
        html3.includes(BLANK_TEXT),
        "step 3: with the document still unloaded, the recompute alone MUST NOT " +
          "recover the cards — the HTML must still be the blank empty state. Got:\n" +
          html3
      );
      assert.ok(
        !html3.includes(CARD_MARKER),
        "step 3: the recompute-only path must NOT paint the comment card while the " +
          "document is unloaded"
      );

      // --- STEP 4: WORST-CASE ASYNC ORDERING, part B. ------------------------
      // The built-in preview finally reloads the target .md asynchronously, AFTER
      // the recompute already ran. onDidOpenTextDocument fires for the target uri;
      // onDocOpened() must render() once so the now-loadable document repaints its
      // comment cards. THIS is the path the developer added.
      provider.__setDocumentResolverForTest(() => mdDoc); // reloaded (async)
      provider.__simulateDocOpenForTest(mdDoc.uri); // real onDidOpen handler -> render()
      const html4 = latest();

      console.log(
        "SIDEBAR-HTML-ASYNC-RELOAD bodies=" +
          JSON.stringify({
            s1_hasCard: html1.includes(CARD_MARKER),
            s2_isBlank: html2.includes(BLANK_TEXT),
            s3_isBlankAfterRecompute: html3.includes(BLANK_TEXT),
            s3_hasCard: html3.includes(CARD_MARKER),
            s4_hasCard: html4.includes(CARD_MARKER),
            paintCount: fake.renderedHtmls.length
          })
      );

      // --- FINAL ASSERTION: onDidOpen recovers the cards. --------------------
      // Fails if onDocOpened is a no-op: html4 would still be the blank state.
      assert.ok(
        html4.includes(CARD_MARKER),
        "step 4: the asynchronous document reload (onDidOpenTextDocument) MUST " +
          "re-paint the comment cards even though the tab-activation recompute " +
          "already ran while the document was unloaded. Latest rendered HTML:\n" +
          html4
      );
    } finally {
      provider.__setDocumentResolverForTest(undefined);
      provider.dispose();
    }
  });
});
