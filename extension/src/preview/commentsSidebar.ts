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

export class CommentsSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "markdownComments.sidebar";

  private view: vscode.WebviewView | undefined;
  private viewListener: vscode.Disposable | undefined;
  private targetUri: vscode.Uri | undefined;
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private lastAppliedVisible: boolean | undefined;
  private readonly editController: CommentEditController;
  private readonly disposables: vscode.Disposable[] = [];

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
    this.editController = new CommentEditController(
      () => this.targetUri,
      () => this.findDocument(),
      () => this.render()
    );

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.recomputeTarget()),
      // Focusing a webview tab (our preview panel or the built-in preview) does
      // not fire onDidChangeActiveTextEditor, so also react to tab changes and
      // to the preview panel's focus so the sidebar follows what the user views.
      onDidChangeActivePreview(() => this.recomputeTarget()),
      vscode.window.tabGroups.onDidChangeTabs(() => this.recomputeTarget()),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.targetUri && e.document.uri.toString() === this.targetUri.toString()) {
          this.scheduleRender();
        }
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => this.onDocClosed(doc.uri)),
      // The built-in preview reloads the target .md ASYNCHRONOUSLY — often AFTER
      // the tab-activation event already ran recomputeTarget() while the document
      // was still unloaded (findDocument() undefined, so setTarget()'s self-heal
      // saw no loadable doc and did not paint the cards). When the document finally
      // opens, re-render so the now-loaded target paints its comment cards. Guarded
      // to the current target only; NOT debounced (the user is waiting to see the
      // cards reappear). render() is idempotent and does not re-enter recompute or
      // emit document events, so this cannot loop.
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
   * Point the sidebar at the document the user is currently looking at: the
   * active Markdown editor, or our interactive preview panel's source, or — when
   * VS Code's BUILT-IN Markdown preview is the active tab — the backing Markdown
   * document (still loaded in workspace.textDocuments even though the preview tab
   * exposes no source uri). Otherwise keep the last target rather than clearing,
   * so switching to a non-Markdown tab doesn't blank the sidebar. The decision is
   * a pure, unit-tested function so this method only marshals vscode state.
   */
  private recomputeTarget(): void {
    const editor = vscode.window.activeTextEditor;
    const activeMarkdownEditorUri =
      editor && editor.document.languageId === "markdown"
        ? editor.document.uri.toString()
        : null;
    const builtInPreviewActive = isBuiltInPreviewActive();
    const previewTabLabel = builtInPreviewActive
      ? vscode.window.tabGroups.activeTabGroup.activeTab?.label ?? null
      : null;
    const openMarkdownUris = vscode.workspace.textDocuments
      .filter((d) => d.languageId === "markdown")
      .map((d) => d.uri.toString());

    const next = chooseSidebarTarget({
      activeMarkdownEditorUri,
      panelSourceUri: CommentsPreviewPanel.activeSourceUri()?.toString() ?? null,
      builtInPreviewActive,
      openMarkdownUris,
      previewTabLabel,
      currentTargetUri: this.targetUri?.toString() ?? null
    });
    this.lastDecisionState = {
      activeMarkdownEditorUri,
      panelSourceUri: CommentsPreviewPanel.activeSourceUri()?.toString() ?? null,
      builtInPreviewActive,
      openMarkdownUris,
      previewTabLabel,
      currentTargetUri: this.targetUri?.toString() ?? null
    };
    this.applyDecision(next);
  }

  /**
   * Apply a recompute decision: record it and, when a target was decided, route
   * it through setTarget() (which carries the change-guard). Extracted so the
   * exact production tail of recomputeTarget() can be exercised directly.
   */
  private applyDecision(next: string | null): void {
    this.lastDecided = next;
    if (next) {
      this.setTarget(vscode.Uri.parse(next));
    }
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
   * onDidOpenTextDocument handling. The built-in preview reloads the target .md
   * asynchronously, frequently after the tab-activation recompute already ran with
   * the document still unloaded — leaving setTarget()'s self-heal unable to repaint
   * the cards. When the target document finally opens, render() once so the loaded
   * document paints its comment cards. Guarded to the current target only; never
   * renders for unrelated documents, and never debounced.
   */
  private onDocOpened(uri: vscode.Uri): void {
    if (this.targetUri && uri.toString() === this.targetUri.toString()) {
      this.render();
    }
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
    // Same target uri as before. The naive change-guard would skip render() here,
    // but the target document's rendered state can change while its uri stays put:
    // returning to the built-in preview reloads a document that had unloaded (the
    // close handler painted the blank empty state), or the document version moved.
    // Force a fresh render ONLY when the render-relevant state actually changed
    // since the last paint, so the sidebar self-heals (re-paints the cards) without
    // thrashing on unrelated events that re-decide the same, unchanged target.
    if (this.renderStateChanged()) {
      this.render();
    }
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
      this.renderLog.push({
        n: this.renderLog.length,
        targetUri: this.lastRenderTargetUri,
        docFound: !!doc,
        hasComments: this.lastRenderHasComments,
        viewResolved: !!this.view
      });
    }
    if (!this.view) {
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
        input instanceof vscode.TabInputWebview &&
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
