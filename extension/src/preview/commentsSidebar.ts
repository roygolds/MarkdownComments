// Word-style comments sidebar. A WebviewView in the activity bar that follows
// the active Markdown editor and shows ONLY that document's comment threads as
// interactive cards (reply / edit / resolve / reopen / delete + collapse / hide
// resolved). It complements — and reuses the same edit pipeline and webview
// script as — the dedicated preview panel.
//
// SECURITY: identical posture to the preview panel — strict nonce-gated CSP,
// all document content HTML-escaped server-side (cardRender), no document data
// in JavaScript, and every inbound message validated and version/uri-guarded by
// the shared CommentEditController.

import * as vscode from "vscode";
import { randomBytes } from "crypto";
import { selectSidebarBody } from "./documentCards";
import { CommentEditController } from "./commentEditController";
import { parseRevealMessage, revealThread, isBuiltInPreviewActive } from "./revealThread";
import { setSidebarVisible, setPendingReveal, clearPendingReveal } from "./previewState";
import { onDidChangeActivePreview, CommentsPreviewPanel } from "./previewPanel";
import { chooseRevealTarget } from "./revealRouting";
import { chooseSidebarTarget } from "./sidebarTarget";
import { classifyActiveTab } from "./activeTabKind";
import type { ActiveTabKind, ActiveTabDescriptor } from "./activeTabKind";

/**
 * Diagnostic-only: a compact description of the focused tab group's active tab —
 * its input kind plus the discriminating detail (webview viewType, text uri, or
 * notebook). Used purely to make the "MarkdownComments" output channel reveal why
 * isBuiltInPreviewActive() resolved the way it did on a given machine.
 */
function describeActiveTab(): string {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (!tab) {
    return "none";
  }
  const input = tab.input;
  const label = JSON.stringify(tab.label);
  if (input instanceof vscode.TabInputWebview) {
    return `webview viewType=${JSON.stringify(input.viewType)} label=${label}`;
  }
  if (input instanceof vscode.TabInputText) {
    return `text uri=${input.uri.toString()} label=${label}`;
  }
  if (input instanceof vscode.TabInputCustom) {
    return `custom viewType=${JSON.stringify(input.viewType)} label=${label}`;
  }
  if (input instanceof vscode.TabInputNotebook) {
    return `notebook label=${label}`;
  }
  if (input === undefined || input === null) {
    return `unknown(no-input) label=${label}`;
  }
  return `other(${(input as { constructor?: { name?: string } }).constructor?.name ?? "?"}) label=${label}`;
}

export class CommentsSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "markdownComments.sidebar";

  private view: vscode.WebviewView | undefined;
  private viewListener: vscode.Disposable | undefined;
  private targetUri: vscode.Uri | undefined;
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private lastAppliedVisible: boolean | undefined;
  private readonly editController: CommentEditController;
  private readonly disposables: vscode.Disposable[] = [];
  // Diagnostic channel ("MarkdownComments" in the Output panel). Always logs a
  // single line per recomputeTarget() and per render() so the live focus/target
  // behaviour is observable on demand without any setting gating. It stays silent
  // until the user opens the channel, so it is cheap to keep on. Disposed in
  // dispose() with the rest of the provider's resources.
  private readonly output: vscode.OutputChannel;

  // Test-only observability. Records the marshaled vscode state and decision from
  // the most recent recomputeTarget(), the ACTUAL sequence of render() calls (what
  // each event-driven render would paint, regardless of whether the webview view
  // resolved headlessly), and whether onDidCloseTextDocument has fired for the
  // current target. The render log is the faithful seam for the blank-sidebar bug:
  // the change-guard in setTarget() can suppress a needed re-render, leaving the
  // last actually-painted body stale. Read only via __sidebarDebug().
  private lastDecisionState: Record<string, unknown> | null = null;
  private lastDecided: string | null = null;
  private closedTargetUris: string[] = [];
  private lastRenderHasComments: boolean | null = null;
  private lastRenderTargetUri: string | null = null;
  // Production render-state tracking (NOT test-only): what the most recent render()
  // actually observed for the current target — whether findDocument() returned a
  // document, and that document's version. setTarget() consults these to self-heal:
  // when a recompute decides the SAME target uri but the target's loadability or
  // version has changed since the last paint (e.g. the user returns to the built-in
  // preview and the document is loadable again after having unloaded), the
  // change-guard must NOT suppress the recovering render.
  private lastRenderedDocFound: boolean | undefined;
  private lastRenderedDocVersion: number | undefined;
  // Signature of the content the webview's html was LAST actually assigned from:
  // `${targetUriString}|${docVersion}|${bodyHtml}` (NOT including the per-render
  // nonce, so identical content truly dedupes). render() compares the freshly
  // computed signature against this; when the view exists, the target uri is
  // unchanged, and the signature matches, it skips reassigning webview.html so an
  // unchanged repaint does not flash/reset the webview. This makes liberal
  // re-renders (now triggered on every recompute that resolves a target) safe.
  private lastRenderedSignature: string | undefined;
  // The target uri the dedupe signature above was painted for. Tracked separately
  // from lastRenderTargetUri (which updates before render()'s early-return) so the
  // "same uri" half of the dedupe guard reflects the last ACTUAL paint.
  private lastRenderedSignatureUri: string | null = null;
  private renderLog: Array<{
    n: number;
    targetUri: string | null;
    docFound: boolean;
    hasComments: boolean;
    viewResolved: boolean;
  }> = [];

  // Test-only seam (no production effect): when set, findDocument() consults this
  // resolver instead of vscode.workspace.textDocuments. The headless integration
  // host pins every commented .md in workspace.textDocuments (CommentController
  // never disposes its threads), so findDocument() can never observe the
  // real-world "document unloaded" condition. Tests inject a resolver to model
  // that condition deterministically and assert on the REAL render() HTML.
  private docResolverOverride: (() => vscode.TextDocument | undefined) | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.output = vscode.window.createOutputChannel("MarkdownComments");
    this.editController = new CommentEditController(
      () => this.targetUri,
      () => this.findDocument(),
      () => this.render()
    );

    this.disposables.push(
      this.output,
      vscode.window.onDidChangeActiveTextEditor(() => this.recomputeTarget()),
      // Focusing a webview tab (our preview panel or the built-in preview) does
      // not fire onDidChangeActiveTextEditor, so also react to tab changes and
      // to the preview panel's focus so the sidebar follows what the user views.
      onDidChangeActivePreview(() => this.recomputeTarget()),
      vscode.window.tabGroups.onDidChangeTabs(() => this.recomputeTarget()),
      // onDidChangeTabs fires when tabs open/close/move, but activating an
      // existing built-in-preview webview tab (e.g. switching back to the .md
      // preview from a .txt) settles the ACTIVE tab via onDidChangeTabGroups.
      // That settle can land AFTER onDidChangeActiveTextEditor cleared the active
      // editor to undefined, when isBuiltInPreviewActive() still read the OLD tab
      // and returned false — so the earlier recompute kept the (stale/blank)
      // target without repainting. Recomputing here runs once the active tab has
      // settled on the preview, so the sidebar reliably repaints its cards.
      vscode.window.tabGroups.onDidChangeTabGroups(() => this.recomputeTarget()),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.targetUri && e.document.uri.toString() === this.targetUri.toString()) {
          this.scheduleRender();
        }
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => this.onDocClosed(doc.uri)),
      // The built-in preview reloads the target .md ASYNCHRONOUSLY. Two cases:
      //   1. PREVIEW-FIRST (the blank-sidebar bug): a file opened straight into the
      //      built-in preview without ever focusing its source editor. At the
      //      tab-activation recompute the backing TextDocument is not yet in
      //      workspace.textDocuments, so chooseSidebarTarget() finds NO loaded
      //      markdown and the target is never adopted — leaving the sidebar blank
      //      until the user visits the source. We must RECOMPUTE (not just render)
      //      when a document opens so the now-loaded backing doc gets adopted while
      //      the preview is active.
      //   2. The target's doc unloaded then reloaded: recompute re-resolves and
      //      render() repaints the cards.
      // recompute is cheap and idempotent (does not emit document events), so this
      // cannot loop. It is NOT debounced — the user is waiting for the cards.
      vscode.workspace.onDidOpenTextDocument((doc) => this.onDocOpened(doc.uri))
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")]
    };
    // Tie the message subscription to this webview's lifetime. resolveWebviewView
    // can run again after the view is hidden and re-shown; dispose the previous
    // listener so handlers don't accumulate across show/hide cycles.
    this.viewListener?.dispose();
    this.viewListener = webviewView.webview.onDidReceiveMessage((msg) => {
      const reveal = parseRevealMessage(msg);
      if (reveal) {
        // Only navigate when the click came from the document the sidebar is
        // currently showing; a stale click from a previous target is ignored.
        if (this.targetUri && reveal.uri === this.targetUri.toString()) {
          // Route the reveal to the surface the user is ACTUALLY looking at, not
          // merely whichever surface happens to be open. Prefer the interactive
          // preview panel when it owns this document; otherwise drive the
          // built-in preview only when it is the focused/visible surface; and
          // when the user is in the raw source (or nothing else applies), reveal
          // the source editor. The decision is a pure, unit-tested function.
          const panelHandled = CommentsPreviewPanel.revealThread(this.targetUri, reveal.threadId);
          const active = vscode.window.activeTextEditor;
          const target = chooseRevealTarget({
            panelHandled,
            builtInPreviewActive: isBuiltInPreviewActive(),
            sourceEditorActive:
              !!active && active.document.uri.toString() === this.targetUri.toString(),
            builtInPreviewOpen: isBuiltInPreviewOpen()
          });
          if (target === "preview") {
            // Drive VS Code's built-in Markdown preview through our contributed
            // preview script: stash the reveal target and refresh so the document
            // re-renders with a scroll anchor that media/preview.js scrolls into
            // view — no raw editor needed.
            setPendingReveal(reveal.threadId);
            void refreshBuiltInPreview();
            // The refresh re-renders and embeds the anchor within a beat; drop the
            // pending target afterwards so an unrelated later refresh (e.g. a
            // different file's preview) can't pick up a stale, possibly colliding
            // thread id.
            setTimeout(() => clearPendingReveal(), 2000);
          } else if (target === "source") {
            void revealThread(this.targetUri, reveal.threadId);
          }
          // target === "panel": already revealed by CommentsPreviewPanel above.
        }
        return;
      }
      void this.editController.handle(msg);
    });

    this.applyVisibility(webviewView.visible);
    this.disposables.push(
      webviewView.onDidChangeVisibility(() => this.onVisibilityChanged(webviewView.visible))
    );

    webviewView.onDidDispose(() => {
      this.viewListener?.dispose();
      this.viewListener = undefined;
      this.view = undefined;
      this.applyVisibility(false);
    });
    // Adopt whatever Markdown document is active when the view opens.
    this.recomputeTarget();
    this.render();
  }

  private onVisibilityChanged(visible: boolean): void {
    if (visible) {
      this.recomputeTarget();
      this.render();
    }
    this.applyVisibility(visible);
  }

  /**
   * Record the sidebar's visibility and, only when it actually changed, re-render
   * the built-in preview so its inline comment cards appear/disappear in step
   * with the sidebar. The change guard avoids redundant global preview refreshes.
   */
  private applyVisibility(visible: boolean): void {
    setSidebarVisible(visible);
    if (this.lastAppliedVisible === visible) {
      return;
    }
    this.lastAppliedVisible = visible;
    void refreshBuiltInPreview();
  }

  /**
   * Point the sidebar at the Markdown document the user is currently looking at, or
   * CLEAR it to the empty state when the active surface is not Markdown.
   *
   * The sidebar shows a document's comments IF AND ONLY IF the currently ACTIVE
   * surface is that Markdown: its source editor, OR our interactive preview panel,
   * OR VS Code's BUILT-IN Markdown preview tab (whose backing document stays loaded
   * in workspace.textDocuments even though the preview tab exposes no source uri).
   * When the active surface is anything else (a non-Markdown editor, an unrelated
   * webview, nothing), the sidebar CLEARS so it does not show stale comments.
   *
   * chooseSidebarTarget() (pure, unit-tested) resolves WHICH markdown is active;
   * its null result no longer means "keep" unconditionally. Instead:
   *   - a resolved uri  -> setTarget(uri)
   *   - null + the active surface is still markdown (the brief transient while
   *     switching from a source editor to its own preview, or an ambiguous
   *     multi-preview) -> KEEP the current target, avoiding a clear/restore flash
   *   - null + a genuinely non-markdown active surface -> clearTarget()
   */
  private recomputeTarget(): void {
    const editor = vscode.window.activeTextEditor;
    const activeMarkdownEditorUri =
      editor && editor.document.languageId === "markdown"
        ? editor.document.uri.toString()
        : null;
    const builtInPreviewActive = isBuiltInPreviewActive();
    // Classify the focused tab so we can recognize "the user is looking at the
    // markdown (source, our panel, or its built-in preview)" even when viewType
    // detection of the built-in preview fails on some machines.
    const kind = this.activeTabKind();
    // The built-in preview is preview-like even if its viewType did not match,
    // and so is any unrecognized webview (with --disable-extensions the only
    // webviews are the built-in preview, our panel, and our sidebar).
    const previewLikeActive =
      builtInPreviewActive || kind === "markdownPreview" || kind === "previewLikeWebview";
    // Pass the active tab's label whenever the surface is preview-like (not only
    // when isBuiltInPreviewActive matched) so chooseSidebarTarget's basename
    // disambiguation still works with multiple open md docs.
    const previewTabLabel = previewLikeActive
      ? vscode.window.tabGroups.activeTabGroup.activeTab?.label ?? null
      : null;
    const panelSourceUri = CommentsPreviewPanel.activeSourceUri()?.toString() ?? null;
    // Only real on-disk/untitled markdown files are candidate targets. The
    // CommentController opens `comment://` input documents (languageId
    // "markdown") for every comment box; those must NOT count as open markdown
    // documents or they pollute the single-doc heuristic in chooseSidebarTarget.
    const openMarkdownUris = vscode.workspace.textDocuments
      .filter(
        (d) =>
          d.languageId === "markdown" &&
          (d.uri.scheme === "file" || d.uri.scheme === "untitled")
      )
      .map((d) => d.uri.toString());
    const activeTabDiag = describeActiveTab();

    // Feed previewLikeActive as the built-in-preview signal so the pure fn's
    // preview branch resolves the backing markdown from the (scheme-filtered)
    // open docs even when viewType detection failed.
    const next = chooseSidebarTarget({
      activeMarkdownEditorUri,
      panelSourceUri,
      builtInPreviewActive: previewLikeActive,
      openMarkdownUris,
      previewTabLabel,
      currentTargetUri: this.targetUri?.toString() ?? null
    });
    this.lastDecisionState = {
      activeMarkdownEditorUri,
      panelSourceUri,
      builtInPreviewActive: previewLikeActive,
      openMarkdownUris,
      previewTabLabel,
      currentTargetUri: this.targetUri?.toString() ?? null
    };

    let outcome: string;
    if (next) {
      // A specific active markdown surface resolved: adopt it.
      this.applyDecision(next);
      outcome = `target=${next}`;
    } else if (kind === "nonMarkdownDoc") {
      // CLEAR ONLY for a genuine other document: a non-md text editor, notebook,
      // or custom editor. (e.g. focusing notes.txt clears the sidebar.)
      this.lastDecided = null;
      this.clearTarget();
      outcome = "CLEAR";
    } else {
      // Ambiguous (comment input, Output panel, no active tab) OR preview-like but
      // nothing resolved yet (no md loaded). KEEP the current target rather than
      // blanking the sidebar — this is what was wrongly blanking the preview.
      this.lastDecided = null;
      outcome = this.targetUri ? "keep" : "keep(no-target)";
    }

    this.logRecompute({
      outcome,
      kind,
      previewLikeActive,
      activeMarkdownEditorUri,
      activeEditorLanguageId: editor ? editor.document.languageId : null,
      activeEditorUri: editor ? editor.document.uri.toString() : null,
      builtInPreviewActive,
      panelSourceUri,
      previewTabLabel,
      openMarkdownUris,
      activeTabDiag
    });
  }

  /**
   * Classify the focused tab group's active tab into the model recomputeTarget()
   * uses to decide target resolution and KEEP-vs-CLEAR. The key reliability fix:
   * built-in-preview detection via viewType is NOT trustworthy on every machine,
   * so an unrecognized webview is treated as preview-like (it can only be the
   * built-in preview, our panel, or our sidebar under --disable-extensions), and
   * non-content schemes (comment:, output:, git:, …) are "ambiguous" so opening
   * the Output panel or a comment input box never clears the sidebar.
   *
   * - No active tab / no input        -> "ambiguous"
   * - TabInputText, file/untitled     -> "markdownSource" if the doc is markdown
   *                                      (languageId, or .md when not yet loaded),
   *                                      else "nonMarkdownDoc"
   * - TabInputText, any other scheme  -> "ambiguous" (not user content)
   * - TabInputWebview, markdown.preview or our panel viewType -> "markdownPreview"
   * - TabInputWebview, anything else  -> "previewLikeWebview"
   * - TabInputNotebook / TabInputCustom -> "nonMarkdownDoc"
   * - otherwise                       -> "ambiguous"
   */
  private activeTabKind(): ActiveTabKind {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return classifyActiveTab(this.describeActiveTabInput(input));
  }

  /**
   * Marshal the focused tab group's active tab input into the dependency-free
   * descriptor that classifyActiveTab() classifies. This is the only part that
   * touches live vscode/workspace state (the TextDocument languageId lookup for a
   * still-loadable text tab); the classification itself is the pure helper, unit
   * tested exhaustively in test/unit/activeTabKind.test.js.
   */
  private describeActiveTabInput(input: unknown): ActiveTabDescriptor {
    if (input === undefined || input === null) {
      return { kind: "none" };
    }
    if (input instanceof vscode.TabInputText) {
      const scheme = input.uri.scheme;
      let languageId: string | undefined;
      if (scheme === "file" || scheme === "untitled") {
        const uriStr = input.uri.toString();
        const doc = vscode.workspace.textDocuments.find(
          (d) => d.uri.toString() === uriStr
        );
        languageId = doc?.languageId;
      }
      return { kind: "text", uriScheme: scheme, languageId, path: input.uri.path };
    }
    if (input instanceof vscode.TabInputWebview) {
      return { kind: "webview", viewType: input.viewType };
    }
    if (input instanceof vscode.TabInputCustom) {
      return { kind: "custom", viewType: input.viewType };
    }
    if (input instanceof vscode.TabInputNotebook) {
      return { kind: "notebook" };
    }
    return { kind: "other" };
  }

  /**
   * Clear the sidebar target so it renders the "Open a Markdown file…" empty state.
   * render() repaints because the cleared content signature (empty uri + no-target
   * body) differs from the last painted cards; an already-cleared sidebar dedupes.
   */
  private clearTarget(): void {
    this.targetUri = undefined;
    this.render();
  }

  /**
   * Apply a recompute decision: record it and, when a target was decided, route
   * it through setTarget() (which carries the change-guard). Extracted so the
   * exact production tail of recomputeTarget() can be exercised directly. Passing
   * null records "no decision" without touching the target (clear is handled by
   * recomputeTarget()'s explicit clearTarget() path).
   */
  private applyDecision(next: string | null): void {
    this.lastDecided = next;
    if (next) {
      this.setTarget(vscode.Uri.parse(next));
    }
  }

  /** A short HH:MM:SS.mmm wall-clock stamp for diagnostic log lines. */
  private stamp(): string {
    return new Date().toISOString().substring(11, 23);
  }

  /**
   * Append one concise diagnostic line per recomputeTarget() to the
   * "MarkdownComments" output channel: the decided outcome and the marshaled
   * vscode state it was decided from. Silent unless the user opens the channel.
   */
  private logRecompute(info: {
    outcome: string;
    kind: ActiveTabKind;
    previewLikeActive: boolean;
    activeMarkdownEditorUri: string | null;
    activeEditorLanguageId: string | null;
    activeEditorUri: string | null;
    builtInPreviewActive: boolean;
    panelSourceUri: string | null;
    previewTabLabel: string | null;
    openMarkdownUris: string[];
    activeTabDiag: string;
  }): void {
    const activeEditor = info.activeEditorUri
      ? `${info.activeEditorUri}(${info.activeEditorLanguageId})`
      : "none";
    this.output.appendLine(
      `${this.stamp()} recompute outcome=${info.outcome} ` +
        `kind=${info.kind} previewLike=${info.previewLikeActive} ` +
        `activeEditor=${activeEditor} builtInPreview=${info.builtInPreviewActive} ` +
        `activeTab=${info.activeTabDiag} ` +
        `panel=${info.panelSourceUri ?? "none"} ` +
        `previewTab=${info.previewTabLabel ? JSON.stringify(info.previewTabLabel) : "none"} ` +
        `openMd=[${info.openMarkdownUris.join(", ")}]`
    );
  }

  /**
   * Exact body of the onDidCloseTextDocument handler. Extracted so a test can
   * invoke the real close-handling path (which calls render()) without depending
   * on the host actually unloading the pinned document.
   */
  private onDocClosed(uri: vscode.Uri): void {
    if (this.targetUri && uri.toString() === this.targetUri.toString()) {
      this.closedTargetUris.push(uri.toString());
      this.render();
    }
  }

  /**
   * onDidOpenTextDocument handling. A markdown document can load AFTER the recompute
   * that should have adopted it already ran:
   *   - PREVIEW-FIRST: a file opened straight into the built-in preview without ever
   *     focusing its source editor — at tab-activation time the backing TextDocument
   *     was not yet in workspace.textDocuments, so chooseSidebarTarget() saw no loaded
   *     markdown and the target was never adopted (the blank-sidebar bug).
   *   - The target's doc unloaded then reloaded.
   * In both cases we must RECOMPUTE (not merely render): recompute re-resolves the
   * active markdown surface against the now-loaded document set and adopts it, then
   * render() paints the cards. recompute is cheap and idempotent — it emits no
   * document events — so this cannot loop, and it is not debounced.
   */
  private onDocOpened(_uri: vscode.Uri): void {
    this.recomputeTarget();
  }

  /**
   * Test-only observability. Reports the ACTUAL last-painted render state (driven
   * by real events — NOT forced here, so the change-guard's suppression is visible)
   * plus current target/decision diagnostics. `forceRecompute` is opt-in for tests
   * that specifically want to probe the pure decision against live state.
   */
  public __sidebarDebug(opts?: { forceRecompute?: boolean }): {
    targetUri: string | null;
    docInWorkspace: boolean;
    lastRenderHasComments: boolean | null;
    lastRenderTargetUri: string | null;
    renderCount: number;
    renderLog: Array<{
      n: number;
      targetUri: string | null;
      docFound: boolean;
      hasComments: boolean;
      viewResolved: boolean;
    }>;
    decided: string | null;
    state: Record<string, unknown> | null;
    isBuiltInPreviewActive: boolean;
    closedTargetFiredForTarget: boolean;
    closedTargetUris: string[];
  } {
    if (opts?.forceRecompute) {
      this.recomputeTarget();
    }
    const document = this.findDocument();
    const targetUri = this.targetUri ? this.targetUri.toString() : null;
    return {
      targetUri,
      docInWorkspace: !!document,
      lastRenderHasComments: this.lastRenderHasComments,
      lastRenderTargetUri: this.lastRenderTargetUri,
      renderCount: this.renderLog.length,
      renderLog: this.renderLog.slice(),
      decided: this.lastDecided,
      state: this.lastDecisionState,
      isBuiltInPreviewActive: isBuiltInPreviewActive(),
      closedTargetFiredForTarget:
        !!targetUri && this.closedTargetUris.includes(targetUri),
      closedTargetUris: this.closedTargetUris.slice()
    };
  }

  private setTarget(uri: vscode.Uri): void {
    if (!this.targetUri || this.targetUri.toString() !== uri.toString()) {
      this.targetUri = uri;
      this.render();
      return;
    }
    // Same target uri as before. Always call render(): render() now dedupes by a
    // content signature (target uri + doc version + body html), so a same-uri
    // recompute that paints nothing new costs nothing (no webview.html reassign,
    // no flicker), while a recompute that finds the document reloaded/changed —
    // e.g. the user returns to the built-in preview after it unloaded the doc and
    // the close handler painted the blank empty state — repaints the cards. This
    // guarantees the invariant: any recompute resolving a non-null target reaches
    // render(), and render() decides via signature whether to actually repaint.
    // renderStateChanged() is retained as an internal observability optimization.
    this.render();
  }

  /**
   * Whether the render-relevant state for the current target differs from what the
   * most recent render() actually painted: the target uri, whether findDocument()
   * now returns a document (availability flipped undefined<->found), or the
   * document's version. Used by setTarget()'s self-heal to re-render a same-uri
   * target whose backing document has become (un)loadable since the last paint.
   */
  private renderStateChanged(): boolean {
    const document = this.findDocument();
    const docFound = !!document;
    const docVersion = this.targetUri && document ? document.version : -1;
    const targetUri = this.targetUri ? this.targetUri.toString() : null;
    return (
      this.lastRenderTargetUri !== targetUri ||
      this.lastRenderedDocFound !== docFound ||
      this.lastRenderedDocVersion !== docVersion
    );
  }

  private findDocument(): vscode.TextDocument | undefined {
    if (this.docResolverOverride) {
      return this.docResolverOverride();
    }
    if (!this.targetUri) {
      return undefined;
    }
    return vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === this.targetUri!.toString()
    );
  }

  /**
   * Test-only seam: install (or clear with `undefined`) a document resolver that
   * findDocument() uses instead of vscode.workspace.textDocuments. Lets a test
   * model the real-world "document loaded / unloaded" condition that the headless
   * host cannot reproduce because it pins commented documents.
   */
  public __setDocumentResolverForTest(
    resolver: (() => vscode.TextDocument | undefined) | undefined
  ): void {
    this.docResolverOverride = resolver;
  }

  /**
   * Test-only seam: drive the exact decision-application tail of recomputeTarget()
   * for a chosen target uri (or null for "no target"), routing it through the real
   * setTarget() change-guard. Models the recompute that fires when the user returns
   * to the built-in preview, without depending on flaky live editor/tab state.
   */
  public __applyDecisionForTest(decidedUri: string | null): void {
    this.applyDecision(decidedUri);
  }

  /**
   * Test-only seam: invoke the real onDidCloseTextDocument handling for `uri`,
   * reproducing the step where the backing document unloads and the provider
   * re-renders (painting the empty state when the document is no longer found).
   */
  public __simulateDocCloseForTest(uri: vscode.Uri): void {
    this.onDocClosed(uri);
  }

  /**
   * Test-only seam: invoke the real onDidOpenTextDocument handling for `uri`,
   * reproducing the step where the built-in preview asynchronously reloads the
   * target document and the provider re-renders (painting the comment cards once
   * the document is loadable again). Mirrors __simulateDocCloseForTest so QA can
   * cover the async-reload path deterministically.
   */
  public __simulateDocOpenForTest(uri: vscode.Uri): void {
    this.onDocOpened(uri);
  }

  private scheduleRender(): void {
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
    }
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      this.render();
    }, 150);
  }

  private render(): void {
    // Test-only: faithfully record what THIS render() call would paint, computed
    // exactly as below, BEFORE the view-resolution early-return. Headlessly the
    // webview view never resolves, so this captured sequence is the only seam that
    // reveals whether the change-guard left a stale (blank) body painted.
    let bodyState: string;
    {
      const doc = this.findDocument();
      const body = selectSidebarBody(
        Boolean(this.targetUri),
        this.targetUri && doc ? doc.getText() : undefined
      );
      this.lastRenderHasComments = !body.includes("mdc-sidebar__empty");
      this.lastRenderTargetUri = this.targetUri ? this.targetUri.toString() : null;
      this.lastRenderedDocFound = !!doc;
      this.lastRenderedDocVersion = this.targetUri && doc ? doc.version : -1;
      // Which of selectSidebarBody()'s three branches this paint hits, for the
      // diagnostic channel: no active markdown target, a target whose document is
      // not loaded, or the rendered comment cards.
      bodyState = !this.targetUri
        ? "empty:no-target"
        : doc
          ? "cards"
          : "empty:doc-not-loaded";
      this.renderLog.push({
        n: this.renderLog.length,
        targetUri: this.lastRenderTargetUri,
        docFound: !!doc,
        hasComments: this.lastRenderHasComments,
        viewResolved: !!this.view
      });
    }
    if (!this.view) {
      this.output.appendLine(
        `${this.stamp()} render (no-view) target=${this.targetUri?.toString() ?? "none"} body=${bodyState}`
      );
      return;
    }
    const webview = this.view.webview;
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "panel.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "panel.css")
    );
    const csp =
      `default-src 'none'; img-src ${webview.cspSource} https: data:; ` +
      `style-src ${webview.cspSource} 'unsafe-inline'; ` +
      `script-src 'nonce-${nonce}'; font-src ${webview.cspSource};`;

    const document = this.findDocument();
    let docVersion = -1;
    if (this.targetUri && document) {
      docVersion = document.version;
    }
    const bodyHtml = selectSidebarBody(
      Boolean(this.targetUri),
      this.targetUri && document ? document.getText() : undefined
    );

    const uri = this.targetUri ? this.targetUri.toString() : "";

    // Dedupe by content signature so liberal re-renders (every recompute that
    // resolves a target now reaches render()) never flash or reset the webview
    // when nothing changed. The signature intentionally EXCLUDES the per-render
    // nonce so identical content truly dedupes. When the view already exists, the
    // target uri is unchanged, and the signature matches the last actually-painted
    // html, skip the reassignment. The render-state trackers above were already
    // updated, so observability stays accurate. Any genuine change (different uri,
    // new doc version, or different body — e.g. a stale blank recovering to cards)
    // produces a new signature and repaints.
    const signature = `${uri}|${docVersion}|${bodyHtml}`;
    const currentUri = this.targetUri ? this.targetUri.toString() : null;
    const deduped =
      this.lastRenderedSignature !== undefined &&
      this.lastRenderedSignature === signature &&
      this.lastRenderedSignatureUri === currentUri;
    this.output.appendLine(
      `${this.stamp()} render (${deduped ? "deduped" : "paint"}) ` +
        `target=${uri || "none"} docFound=${!!document} body=${bodyState}`
    );
    if (deduped) {
      return;
    }
    this.lastRenderedSignature = signature;
    this.lastRenderedSignatureUri = currentUri;

    webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri.toString()}" />
  <title>Comments</title>
</head>
<body class="mdc-sidebar" data-uri="${escapeAttr(uri)}" data-doc-version="${docVersion}">
  <div class="mdc-toolbar" role="toolbar" aria-label="Comment controls">
    <button type="button" class="mdc-toolbar__btn" data-toggle="collapse-comments" aria-pressed="false">Collapse all</button>
    <button type="button" class="mdc-toolbar__btn" data-toggle="hide-resolved" aria-pressed="false">Hide resolved</button>
  </div>
  <div class="mdc-panel__body">
${bodyHtml}
  </div>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }

  dispose(): void {
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
    }
    this.viewListener?.dispose();
    this.viewListener = undefined;
    setSidebarVisible(false);
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

let refreshCommand: string | undefined;

/**
 * Whether any open tab is VS Code's built-in Markdown preview. Its webview tab
 * has a viewType containing "markdown.preview" (e.g. "mainThreadWebview-markdown.preview");
 * our own panel's viewType is "markdownCommentsPreview" (no dot) and is excluded.
 * The match is content-scoped downstream: a refresh only injects a scroll anchor
 * for the document that actually contains the target thread, so previews of other
 * files are unaffected.
 */
function isBuiltInPreviewOpen(): boolean {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (
        (input instanceof vscode.TabInputWebview ||
          input instanceof vscode.TabInputCustom) &&
        input.viewType.toLowerCase().includes("markdown.preview")
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Re-render VS Code's built-in Markdown preview so its inline comment cards
 * reflect the current sidebar visibility. `markdown.preview.refresh` cleans the
 * markdown engine cache and refreshes every open preview, which re-runs our
 * fence renderer (and so re-reads the sidebar-visible flag). `markdown.api.reloadPlugins`
 * only reloads plugin code and does NOT refresh already-open previews, so it is
 * used only as a fallback. Failures are swallowed; the preview still updates on
 * the next document change.
 */
async function refreshBuiltInPreview(): Promise<void> {
  try {
    if (refreshCommand === undefined) {
      const commands = await vscode.commands.getCommands(true);
      refreshCommand = commands.includes("markdown.preview.refresh")
        ? "markdown.preview.refresh"
        : commands.includes("markdown.api.reloadPlugins")
          ? "markdown.api.reloadPlugins"
          : "";
    }
    if (refreshCommand) {
      await vscode.commands.executeCommand(refreshCommand);
    }
  } catch {
    /* best effort */
  }
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function makeNonce(): string {
  return randomBytes(24).toString("base64").replace(/[^A-Za-z0-9]/g, "");
}
