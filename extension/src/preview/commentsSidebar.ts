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
import { parseRevealMessage, revealThread } from "./revealThread";
import { setSidebarVisible } from "./previewState";
import { onDidChangeActivePreview, CommentsPreviewPanel } from "./previewPanel";

export class CommentsSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "markdownComments.sidebar";

  private view: vscode.WebviewView | undefined;
  private viewListener: vscode.Disposable | undefined;
  private targetUri: vscode.Uri | undefined;
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private lastAppliedVisible: boolean | undefined;
  private readonly editController: CommentEditController;
  private readonly disposables: vscode.Disposable[] = [];

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
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (this.targetUri && doc.uri.toString() === this.targetUri.toString()) {
          this.render();
        }
      })
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
          // Prefer focusing the comment inside the interactive preview panel
          // when it is open for this document; otherwise reveal the source line.
          if (!CommentsPreviewPanel.revealThread(this.targetUri, reveal.threadId)) {
            void revealThread(this.targetUri, reveal.threadId);
          }
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
   * active Markdown editor, or — when a webview tab is focused — the source of
   * our interactive preview panel. Otherwise keep the last target rather than
   * clearing, so switching to a non-Markdown tab doesn't blank the sidebar.
   */
  private recomputeTarget(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.languageId === "markdown") {
      this.setTarget(editor.document.uri);
      return;
    }
    const previewUri = CommentsPreviewPanel.activeSourceUri();
    if (previewUri) {
      this.setTarget(previewUri);
    }
  }

  private setTarget(uri: vscode.Uri): void {
    if (!this.targetUri || this.targetUri.toString() !== uri.toString()) {
      this.targetUri = uri;
      this.render();
    }
  }

  private findDocument(): vscode.TextDocument | undefined {
    if (!this.targetUri) {
      return undefined;
    }
    return vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === this.targetUri!.toString()
    );
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
