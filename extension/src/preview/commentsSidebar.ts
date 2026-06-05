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

export class CommentsSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "markdownComments.sidebar";

  private view: vscode.WebviewView | undefined;
  private viewListener: vscode.Disposable | undefined;
  private targetUri: vscode.Uri | undefined;
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly editController: CommentEditController;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {
    this.editController = new CommentEditController(
      () => this.targetUri,
      () => this.findDocument(),
      () => this.render()
    );

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => this.onActiveEditor(editor)),
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
    this.viewListener = webviewView.webview.onDidReceiveMessage(
      (msg) => void this.editController.handle(msg)
    );
    webviewView.onDidDispose(() => {
      this.viewListener?.dispose();
      this.viewListener = undefined;
      this.view = undefined;
    });
    // Adopt whatever Markdown document is active when the view opens.
    this.onActiveEditor(vscode.window.activeTextEditor);
    this.render();
  }

  private onActiveEditor(editor: vscode.TextEditor | undefined): void {
    if (editor && editor.document.languageId === "markdown") {
      if (!this.targetUri || this.targetUri.toString() !== editor.document.uri.toString()) {
        this.targetUri = editor.document.uri;
        this.render();
      }
    }
    // When a non-Markdown editor becomes active, keep showing the last Markdown
    // document's comments rather than clearing the sidebar.
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
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
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
